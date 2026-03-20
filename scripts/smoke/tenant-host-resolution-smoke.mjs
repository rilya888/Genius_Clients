const API_BASE_URL = process.env.SMOKE_API_BASE_URL ?? "https://api-production-9caa.up.railway.app";
const TENANT_SLUG = process.env.SMOKE_TENANT_SLUG ?? "demo";
const AUTOREGISTER = process.env.SMOKE_TENANT_AUTOREGISTER === "1";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const bodyText = await response.text();
  let payload = null;
  try {
    payload = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    payload = null;
  }
  return { response, payload, bodyText };
}

async function main() {
  const health = await request("/api/v1/health");
  assert(health.response.ok, `health failed: ${health.response.status}`);

  // On Railway temporary domain, host resolver should not match tenant host.
  // Without tenant header, public route must reject tenant context.
  const withoutHeader = await request("/api/v1/public/services");
  assert(!withoutHeader.response.ok, "public/services without tenant context must fail");
  assert(
    withoutHeader.payload?.error?.code === "TENANT_NOT_FOUND",
    `unexpected error code without header: ${withoutHeader.payload?.error?.code ?? "unknown"}`
  );

  // Header fallback must stay functional until custom tenant domain is connected.
  let effectiveTenantSlug = TENANT_SLUG;
  let withHeader = await request("/api/v1/public/services", {
    headers: {
      "x-internal-tenant-slug": effectiveTenantSlug
    }
  });

  if (
    AUTOREGISTER &&
    withHeader.response.status === 404 &&
    withHeader.payload?.error?.code === "TENANT_NOT_FOUND"
  ) {
    const nonce = Date.now();
    const registerResponse = await request("/api/v1/auth/register", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        businessName: `Smoke Tenant ${nonce}`,
        email: `smoke.tenant.${nonce}@example.com`,
        password: "Smoke!123"
      })
    });
    assert(registerResponse.response.ok, `autoregister failed: ${registerResponse.response.status}`);
    effectiveTenantSlug = registerResponse.payload?.data?.slug;
    assert(typeof effectiveTenantSlug === "string" && effectiveTenantSlug.length > 0, "autoregister slug missing");
    withHeader = await request("/api/v1/public/services", {
      headers: {
        "x-internal-tenant-slug": effectiveTenantSlug
      }
    });
  }

  assert(withHeader.response.ok, `public/services with tenant header failed: ${withHeader.response.status}`);
  assert(Array.isArray(withHeader.payload?.data?.items), "public/services payload shape mismatch");

  console.log(
    `tenant host resolution smoke: OK (api=${API_BASE_URL}, tenantSlug=${effectiveTenantSlug}, services=${withHeader.payload.data.items.length})`
  );
}

main().catch((error) => {
  console.error(`tenant host resolution smoke: FAILED - ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
