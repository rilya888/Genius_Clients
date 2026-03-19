import test from "node:test";
import assert from "node:assert/strict";
import { signSuperAdminToken, verifySuperAdminToken } from "./token";

test("sign/verify super-admin token succeeds with same secret", () => {
  const secret = "super_admin_secret_for_test";
  const token = signSuperAdminToken({ secret, ttlSeconds: 60 });
  const payload = verifySuperAdminToken(token, secret);

  assert.ok(payload);
  assert.equal(payload?.role, "super_admin");
  assert.ok((payload?.exp ?? 0) > (payload?.iat ?? 0));
});

test("verify returns null for wrong secret", () => {
  const token = signSuperAdminToken({ secret: "secret_a", ttlSeconds: 60 });
  const payload = verifySuperAdminToken(token, "secret_b");
  assert.equal(payload, null);
});

test("verify returns null for expired token", async () => {
  const secret = "super_admin_secret_for_expire_test";
  const token = signSuperAdminToken({ secret, ttlSeconds: 1 });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const payload = verifySuperAdminToken(token, secret);
  assert.equal(payload, null);
});
