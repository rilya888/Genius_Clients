#!/usr/bin/env node

const API_BASE_URL =
  process.env.SMOKE_API_URL ?? process.env.API_URL ?? process.env.VITE_API_URL ?? "http://localhost:8787";
const SUPER_ADMIN_SECRET = process.env.SMOKE_SUPER_ADMIN_SECRET ?? process.env.SUPER_ADMIN_LOGIN_SECRET;
const ALLOW_MUTATION = process.env.SMOKE_SUPER_ADMIN_MUTATION === "1";

if (!SUPER_ADMIN_SECRET) {
  throw new Error("SMOKE_SUPER_ADMIN_SECRET (or SUPER_ADMIN_LOGIN_SECRET) is required");
}

if (!ALLOW_MUTATION) {
  throw new Error("Set SMOKE_SUPER_ADMIN_MUTATION=1 to run mutating super-admin smoke flow");
}

function url(path) {
  return new URL(path, API_BASE_URL).toString();
}

function assertOk(response, payload, label) {
  if (!response.ok) {
    const message = payload?.error?.message ?? `HTTP_${response.status}`;
    throw new Error(`[super-admin-smoke] ${label} failed: ${message}`);
  }
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("content-type", "application/json");
  const response = await fetch(url(path), { ...init, headers });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function requestAuthed(path, cookie, init = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("cookie", cookie);
  headers.set("x-csrf-token", "smoke-super-admin");
  return request(path, { ...init, headers });
}

function pickPlan(items) {
  const editable = items.find((item) => item.code !== "enterprise");
  return editable ?? items[0] ?? null;
}

const loginResult = await request("/api/v1/super-admin/auth/login", {
  method: "POST",
  headers: { "x-csrf-token": "smoke-super-admin" },
  body: JSON.stringify({ secret: SUPER_ADMIN_SECRET })
});
assertOk(loginResult.response, loginResult.payload, "login");
const setCookie = loginResult.response.headers.get("set-cookie");
if (!setCookie) {
  throw new Error("[super-admin-smoke] login response has no set-cookie");
}
const cookie = setCookie.split(";")[0];

const plansBeforeResult = await requestAuthed("/api/v1/super-admin/plans", cookie);
assertOk(plansBeforeResult.response, plansBeforeResult.payload, "get plans (before)");
const plansBefore = plansBeforeResult.payload?.data?.items ?? [];
const targetPlan = pickPlan(plansBefore);
if (!targetPlan) {
  throw new Error("[super-admin-smoke] no plans returned");
}
const originalPrice = Number(targetPlan.priceCents);
const temporaryPrice = originalPrice + 100;

const versionsBeforeResult = await requestAuthed("/api/v1/super-admin/plan-versions?limit=1", cookie);
assertOk(versionsBeforeResult.response, versionsBeforeResult.payload, "get versions (before)");
const versionBefore = Number(versionsBeforeResult.payload?.data?.items?.[0]?.version ?? 0);
if (!Number.isInteger(versionBefore) || versionBefore < 1) {
  throw new Error("[super-admin-smoke] cannot determine baseline version");
}

const updateResult = await requestAuthed(`/api/v1/super-admin/plans/${targetPlan.id}`, cookie, {
  method: "PUT",
  body: JSON.stringify({ priceCents: temporaryPrice, actor: "smoke_super_admin" })
});
assertOk(updateResult.response, updateResult.payload, "update plan price");

const diffResult = await requestAuthed("/api/v1/super-admin/plans/diff", cookie);
assertOk(diffResult.response, diffResult.payload, "diff");
const diffItems = diffResult.payload?.data?.items ?? [];
const hasTargetDiff = diffItems.some((item) => item.code === targetPlan.code);
if (!hasTargetDiff) {
  throw new Error("[super-admin-smoke] diff does not include updated plan");
}

const publishResult = await requestAuthed("/api/v1/super-admin/plans/publish", cookie, {
  method: "POST",
  body: JSON.stringify({ actor: "smoke_super_admin" })
});
assertOk(publishResult.response, publishResult.payload, "publish");
const publishedVersion = Number(publishResult.payload?.data?.version ?? 0);
if (!Number.isInteger(publishedVersion) || publishedVersion <= versionBefore) {
  throw new Error("[super-admin-smoke] publish did not create a newer version");
}

const versionsAfterPublishResult = await requestAuthed("/api/v1/super-admin/plan-versions?limit=3", cookie);
assertOk(versionsAfterPublishResult.response, versionsAfterPublishResult.payload, "get versions (after publish)");
const topVersionAfterPublish = Number(versionsAfterPublishResult.payload?.data?.items?.[0]?.version ?? 0);
if (topVersionAfterPublish !== publishedVersion) {
  throw new Error("[super-admin-smoke] latest version does not match published version");
}

const rollbackResult = await requestAuthed(`/api/v1/super-admin/plans/rollback/${versionBefore}`, cookie, {
  method: "POST",
  body: JSON.stringify({ actor: "smoke_super_admin" })
});
assertOk(rollbackResult.response, rollbackResult.payload, "rollback");

const plansAfterRollbackResult = await requestAuthed("/api/v1/super-admin/plans", cookie);
assertOk(plansAfterRollbackResult.response, plansAfterRollbackResult.payload, "get plans (after rollback)");
const restored = (plansAfterRollbackResult.payload?.data?.items ?? []).find(
  (item) => item.code === targetPlan.code
);
if (!restored) {
  throw new Error("[super-admin-smoke] target plan missing after rollback");
}
if (Number(restored.priceCents) !== originalPrice) {
  throw new Error("[super-admin-smoke] rollback did not restore original plan price");
}

console.log(
  `[super-admin-smoke] OK (plan=${targetPlan.code}, baseline=v${versionBefore}, published=v${publishedVersion}, restoredPrice=${originalPrice})`
);
