#!/usr/bin/env node

import crypto from "node:crypto";

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function buildStripeSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedPayload = `${timestamp}.${payload}`;
  const digest = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

async function postEvent(url, rawPayload, signatureHeader) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signatureHeader
    },
    body: rawPayload
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function main() {
  const apiBase = required("SMOKE_API_BASE_URL").replace(/\/$/, "");
  const webhookSecret = required("STRIPE_WEBHOOK_SECRET");
  const tenantId = required("STRIPE_TEST_TENANT_ID");

  const eventId = `evt_smoke_${Date.now()}`;
  const payloadObject = {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_smoke_${Date.now()}`,
        customer: "cus_smoke_idempotency",
        customer_email: "stripe-smoke@example.com",
        metadata: {
          tenant_id: tenantId,
          user_id: "stripe-smoke-user"
        }
      }
    }
  };

  const rawPayload = JSON.stringify(payloadObject);
  const signatureHeader = buildStripeSignature(rawPayload, webhookSecret);
  const endpoint = `${apiBase}/api/v1/webhooks/stripe`;

  const first = await postEvent(endpoint, rawPayload, signatureHeader);
  if (!first.response.ok) {
    throw new Error(`First webhook call failed: ${first.response.status} ${JSON.stringify(first.payload)}`);
  }

  const second = await postEvent(endpoint, rawPayload, signatureHeader);
  if (!second.response.ok) {
    throw new Error(`Second webhook call failed: ${second.response.status} ${JSON.stringify(second.payload)}`);
  }

  const firstDedup = first.payload?.data?.deduplicated;
  const secondDedup = second.payload?.data?.deduplicated;

  if (firstDedup !== false) {
    throw new Error(`Expected first call deduplicated=false, got ${JSON.stringify(first.payload)}`);
  }
  if (secondDedup !== true) {
    throw new Error(`Expected second call deduplicated=true, got ${JSON.stringify(second.payload)}`);
  }

  console.log("[smoke:stripe] idempotency OK");
  console.log(`endpoint=${endpoint}`);
  console.log(`eventId=${eventId}`);
}

main().catch((error) => {
  console.error("[smoke:stripe] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
