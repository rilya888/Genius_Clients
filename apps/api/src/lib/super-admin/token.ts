import { createHmac, timingSafeEqual } from "node:crypto";

export type SuperAdminTokenPayload = {
  role: "super_admin";
  iat: number;
  exp: number;
};

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPart(payloadPart: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

export function signSuperAdminToken(input: {
  secret: string;
  ttlSeconds: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SuperAdminTokenPayload = {
    role: "super_admin",
    iat: now,
    exp: now + Math.max(1, Math.floor(input.ttlSeconds))
  };

  const payloadPart = encodeBase64Url(JSON.stringify(payload));
  const signature = signPart(payloadPart, input.secret);
  return `${payloadPart}.${signature}`;
}

export function verifySuperAdminToken(token: string, secret: string): SuperAdminTokenPayload | null {
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) {
    return null;
  }

  const expectedSignature = signPart(payloadPart, secret);
  const signatureBuf = Buffer.from(signaturePart);
  const expectedBuf = Buffer.from(expectedSignature);

  if (signatureBuf.length !== expectedBuf.length) {
    return null;
  }

  if (!timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }

  let payload: SuperAdminTokenPayload;
  try {
    payload = JSON.parse(decodeBase64Url(payloadPart)) as SuperAdminTokenPayload;
  } catch {
    return null;
  }

  if (payload.role !== "super_admin" || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return null;
  }

  return payload;
}
