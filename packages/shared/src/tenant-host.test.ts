import test from "node:test";
import assert from "node:assert/strict";
import { extractTenantSlugFromHost, normalizeHost } from "./tenant-host";

test("normalizeHost handles host and forwarded-host values", () => {
  assert.equal(normalizeHost("My-Salon.GeniusClients.info:443"), "my-salon.geniusclients.info");
  assert.equal(normalizeHost("a.example.com, b.example.com"), "a.example.com");
  assert.equal(normalizeHost(""), null);
});

test("extractTenantSlugFromHost resolves valid tenant subdomain", () => {
  assert.equal(extractTenantSlugFromHost("roma.geniusclients.info", "geniusclients.info"), "roma");
  assert.equal(extractTenantSlugFromHost("roma.geniusclients.info:443", "geniusclients.info"), "roma");
});

test("extractTenantSlugFromHost rejects base domain and reserved names", () => {
  assert.equal(extractTenantSlugFromHost("geniusclients.info", "geniusclients.info"), null);
  assert.equal(extractTenantSlugFromHost("api.geniusclients.info", "geniusclients.info"), null);
  assert.equal(extractTenantSlugFromHost("www.geniusclients.info", "geniusclients.info"), null);
});

test("extractTenantSlugFromHost rejects nested and invalid subdomains", () => {
  assert.equal(extractTenantSlugFromHost("a.b.geniusclients.info", "geniusclients.info"), null);
  assert.equal(extractTenantSlugFromHost("roma_1.geniusclients.info", "geniusclients.info"), null);
  assert.equal(extractTenantSlugFromHost("other-domain.com", "geniusclients.info"), null);
});
