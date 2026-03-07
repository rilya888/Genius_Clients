import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;

/**
 * Hashes user passwords with per-password random salt.
 */
export function hashPassword(plainTextPassword: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plainTextPassword, salt, SCRYPT_KEY_LENGTH).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(plainTextPassword: string, storedHash: string): boolean {
  const [salt, expected] = storedHash.split(":");
  if (!salt || !expected) {
    return false;
  }

  const actual = scryptSync(plainTextPassword, salt, SCRYPT_KEY_LENGTH).toString("hex");
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}
