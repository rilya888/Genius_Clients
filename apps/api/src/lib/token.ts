import { createHmac, timingSafeEqual } from "node:crypto";

type SessionTokenPayload = {
  sub: string;
  tenantId: string;
  tokenVersion: number;
  type: "access" | "refresh";
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

export function signSessionToken(
  payload: Omit<SessionTokenPayload, "exp"> & { ttlSeconds: number },
  secret: string
): string {
  const tokenPayload: SessionTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + payload.ttlSeconds
  };
  const payloadPart = encodeBase64Url(JSON.stringify(tokenPayload));
  const signature = signPart(payloadPart, secret);
  return `${payloadPart}.${signature}`;
}

export function verifySessionToken(token: string, secret: string): SessionTokenPayload | null {
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

  let payload: SessionTokenPayload;
  try {
    payload = JSON.parse(decodeBase64Url(payloadPart)) as SessionTokenPayload;
  } catch {
    return null;
  }

  if (
    !payload?.sub ||
    !payload?.tenantId ||
    !Number.isInteger(payload?.tokenVersion) ||
    (payload?.type !== "access" && payload?.type !== "refresh") ||
    !Number.isInteger(payload?.exp)
  ) {
    return null;
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowUnix) {
    return null;
  }

  return payload;
}

