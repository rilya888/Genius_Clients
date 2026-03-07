import { randomUUID } from "crypto";

const CSRF_COOKIE = "csrf_token";

/**
 * Returns a deterministic CSRF token source for state-changing BFF requests.
 */
export function generateCsrfToken(): string {
  return randomUUID();
}

export function getCsrfCookieName(): string {
  return CSRF_COOKIE;
}
