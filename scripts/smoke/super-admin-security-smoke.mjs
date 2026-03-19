#!/usr/bin/env node

const API_BASE_URL =
  process.env.SMOKE_API_URL ?? process.env.API_URL ?? process.env.VITE_API_URL ?? "http://localhost:8787";
const SUPER_ADMIN_SECRET = process.env.SMOKE_SUPER_ADMIN_SECRET ?? process.env.SUPER_ADMIN_LOGIN_SECRET;
const RUN_RATE_LIMIT_CHECK = process.env.SMOKE_SUPER_ADMIN_RATE_LIMIT === "1";

if (!SUPER_ADMIN_SECRET) {
  throw new Error("SMOKE_SUPER_ADMIN_SECRET (or SUPER_ADMIN_LOGIN_SECRET) is required");
}

function url(path) {
  return new URL(path, API_BASE_URL).toString();
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("content-type", "application/json");
  const response = await fetch(url(path), { ...init, headers });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function expectStatus(result, expected, label) {
  if (result.response.status !== expected) {
    throw new Error(
      `[super-admin-security-smoke] ${label}: expected ${expected}, got ${result.response.status}`
    );
  }
}

const noCsrfLogin = await request("/api/v1/super-admin/auth/login", {
  method: "POST",
  body: JSON.stringify({ secret: SUPER_ADMIN_SECRET })
});
expectStatus(noCsrfLogin, 403, "login without csrf");

const wrongSecretLogin = await request("/api/v1/super-admin/auth/login", {
  method: "POST",
  headers: { "x-csrf-token": "smoke-super-admin" },
  body: JSON.stringify({ secret: "wrong_secret_value" })
});
expectStatus(wrongSecretLogin, 401, "login with wrong secret");

const login = await request("/api/v1/super-admin/auth/login", {
  method: "POST",
  headers: { "x-csrf-token": "smoke-super-admin" },
  body: JSON.stringify({ secret: SUPER_ADMIN_SECRET })
});
expectStatus(login, 200, "login with valid secret");
const setCookie = login.response.headers.get("set-cookie");
if (!setCookie) {
  throw new Error("[super-admin-security-smoke] login response has no set-cookie");
}
const cookie = setCookie.split(";")[0];

const noCsrfMutation = await request("/api/v1/super-admin/plans/publish", {
  method: "POST",
  headers: { cookie },
  body: JSON.stringify({ actor: "smoke_super_admin" })
});
expectStatus(noCsrfMutation, 403, "mutation without csrf");

if (RUN_RATE_LIMIT_CHECK) {
  let sawRateLimited = false;
  for (let i = 0; i < 30; i += 1) {
    const result = await request("/api/v1/super-admin/auth/login", {
      method: "POST",
      headers: { "x-csrf-token": "smoke-super-admin" },
      body: JSON.stringify({ secret: "rate_limit_probe_invalid" })
    });
    if (result.response.status === 429) {
      sawRateLimited = true;
      break;
    }
  }
  if (!sawRateLimited) {
    throw new Error("[super-admin-security-smoke] did not observe 429 on login rate-limit probe");
  }
}

console.log(
  `[super-admin-security-smoke] OK${RUN_RATE_LIMIT_CHECK ? " (including rate-limit probe)" : ""}`
);
