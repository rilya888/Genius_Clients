import Redis from "ioredis";

let client: Redis | null = null;
let initAttempted = false;

function getRedisUrl(): string | null {
  const raw = process.env.REDIS_URL?.trim();
  return raw ? raw : null;
}

export function getRedisClient(): Redis | null {
  if (initAttempted) {
    return client;
  }

  initAttempted = true;
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    client = null;
    return client;
  }

  client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false
  });

  client.on("error", (error) => {
    console.error("[api] redis client error", error);
  });

  return client;
}

export async function pingRedis(): Promise<"ok" | "disabled" | "error"> {
  const redis = getRedisClient();
  if (!redis) {
    return "disabled";
  }

  try {
    if (redis.status === "wait") {
      await redis.connect();
    }
    const response = await redis.ping();
    return response === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  }
}
