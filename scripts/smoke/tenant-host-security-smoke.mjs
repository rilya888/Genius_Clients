const API_BASE_URL = process.env.SMOKE_API_BASE_URL ?? "https://api-production-9caa.up.railway.app";
const TENANT_SLUG = process.env.SMOKE_TENANT_SLUG ?? "demo";

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
  return { response, payload };
}

async function main() {
  const spoofedOnly = await request("/api/v1/public/services", {
    headers: {
      "x-forwarded-host": `${TENANT_SLUG}.geniusclients.info`
    }
  });
  assert(!spoofedOnly.response.ok, "x-forwarded-host spoof without tenant header must fail");
  assert(
    spoofedOnly.payload?.error?.code === "TENANT_NOT_FOUND",
    `unexpected code for spoof-only request: ${spoofedOnly.payload?.error?.code ?? "unknown"}`
  );

  const spoofedWithHeader = await request("/api/v1/public/services", {
    headers: {
      "x-forwarded-host": `${TENANT_SLUG}.geniusclients.info`,
      "x-internal-tenant-slug": TENANT_SLUG
    }
  });
  assert(
    spoofedWithHeader.response.ok || spoofedWithHeader.payload?.error?.code === "TENANT_NOT_FOUND",
    `unexpected response with header fallback: ${spoofedWithHeader.response.status}`
  );

  console.log(
    `tenant host security smoke: OK (api=${API_BASE_URL}, spoofOnlyStatus=${spoofedOnly.response.status}, headerFallbackStatus=${spoofedWithHeader.response.status})`
  );
}

main().catch((error) => {
  console.error(`tenant host security smoke: FAILED - ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
