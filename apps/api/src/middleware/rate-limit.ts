import type { Context, Next } from "hono";
import type { ApiAppEnv } from "../lib/hono-env";
import { appError } from "../lib/http";
import { getRedisClient } from "../lib/redis";

const counters = new Map<string, { count: number; resetAt: number }>();
const REDIS_RATE_LIMIT_PREFIX = process.env.RATE_LIMIT_REDIS_PREFIX ?? "rl:v1";
const REDIS_REQUIRED =
  process.env.RATE_LIMIT_REDIS_REQUIRED === "true" ||
  (process.env.NODE_ENV === "production" && process.env.RATE_LIMIT_REDIS_REQUIRED !== "false");
const RATE_LIMIT_FAIL_CLOSED = process.env.RATE_LIMIT_FAIL_CLOSED === "true";
let lastDegradedLogAt = 0;

function getClientIp(c: Context<ApiAppEnv>): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return c.req.header("x-real-ip") ?? "unknown";
}

function getPolicy(path: string): { limit: number; windowMs: number; bucket: string } {
  if (path.includes("/auth/register")) {
    return { limit: 20, windowMs: 60_000, bucket: "auth-register" };
  }
  if (path.includes("/auth/request-email-verification") || path.includes("/auth/verify-email/resend")) {
    return { limit: 15, windowMs: 60_000, bucket: "auth-verify-resend" };
  }
  if (path.includes("/auth/forgot-password")) {
    return { limit: 15, windowMs: 60_000, bucket: "auth-forgot-password" };
  }
  if (path.includes("/auth/reset-password")) {
    return { limit: 25, windowMs: 60_000, bucket: "auth-reset-password" };
  }
  if (path.includes("/super-admin/auth/login")) {
    return { limit: 20, windowMs: 60_000, bucket: "super-admin-login" };
  }
  if (path.includes("/auth/")) {
    return { limit: 60, windowMs: 60_000, bucket: "auth" };
  }
  if (path.includes("/public/bookings")) {
    return { limit: 100, windowMs: 60_000, bucket: "public-bookings" };
  }
  if (path.includes("/public/slots")) {
    return { limit: 200, windowMs: 60_000, bucket: "public-slots" };
  }
  if (path.includes("/webhooks/")) {
    return { limit: 300, windowMs: 60_000, bucket: "webhooks" };
  }

  return { limit: 120, windowMs: 60_000, bucket: "default" };
}

function sweep(now: number): void {
  for (const [key, value] of counters.entries()) {
    if (value.resetAt <= now) {
      counters.delete(key);
    }
  }
}

async function incrementRedisCounter(input: {
  key: string;
  windowMs: number;
  now: number;
}): Promise<{ count: number; resetAt: number } | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }

  try {
    if (redis.status === "wait") {
      await redis.connect();
    }

    const namespacedKey = `${REDIS_RATE_LIMIT_PREFIX}:${input.key}`;
    const count = await redis.incr(namespacedKey);
    if (count === 1) {
      await redis.pexpire(namespacedKey, input.windowMs);
    }
    const ttlMs = await redis.pttl(namespacedKey);
    const resetAt = input.now + Math.max(ttlMs, 0);
    return { count, resetAt };
  } catch (error) {
    console.error("[api] redis rate-limit increment failed", error);
    return null;
  }
}

function incrementMemoryCounter(input: {
  key: string;
  windowMs: number;
  now: number;
}): { count: number; resetAt: number } {
  const current = counters.get(input.key);
  if (!current || current.resetAt <= input.now) {
    const fresh = { count: 1, resetAt: input.now + input.windowMs };
    counters.set(input.key, fresh);
    return fresh;
  }

  const updated = { count: current.count + 1, resetAt: current.resetAt };
  counters.set(input.key, updated);
  return updated;
}

export async function rateLimitMiddleware(c: Context<ApiAppEnv>, next: Next) {
  const now = Date.now();
  if (counters.size > 10_000) {
    sweep(now);
  }

  const path = c.req.path;
  const isWebhookPath = path.includes("/webhooks/");
  const policy = getPolicy(path);
  const ip = getClientIp(c);
  const tenant = c.get("tenantId") ?? c.req.header("x-internal-tenant-id") ?? "no-tenant";
  const key = `${policy.bucket}:${ip}:${tenant}`;
  const redisCounter = await incrementRedisCounter({
    key,
    windowMs: policy.windowMs,
    now
  });
  // Degraded mode: avoid full auth/public/admin outage when Redis is transiently unavailable.
  // Use fail-closed only when explicitly requested by env.
  if (!redisCounter && REDIS_REQUIRED && RATE_LIMIT_FAIL_CLOSED && !isWebhookPath) {
    throw appError("INTERNAL_ERROR", { reason: "rate_limit_store_unavailable" });
  }
  if (!redisCounter && REDIS_REQUIRED && !isWebhookPath) {
    if (now - lastDegradedLogAt > 60_000) {
      lastDegradedLogAt = now;
      console.warn("[api] rate-limit degraded mode: using in-memory fallback because redis is unavailable");
    }
  }
  const counter =
    redisCounter ??
    incrementMemoryCounter({
      key,
      windowMs: policy.windowMs,
      now
    });

  if (counter.count > policy.limit) {
    throw appError("RATE_LIMITED", {
      reason: "rate_limit_exceeded",
      bucket: policy.bucket,
      retryAfterMs: counter.resetAt - now
    });
  }

  await next();
}
