const RESERVED_SLUGS = new Set(["admin", "api", "app", "www", "static", "status"]);

export function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function assertValidSlug(slug: string): void {
  if (slug.length < 3 || slug.length > 40) {
    throw new Error("Slug length must be between 3 and 40 characters");
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error("Slug may contain only a-z, 0-9, and '-' characters");
  }

  if (RESERVED_SLUGS.has(slug)) {
    throw new Error("Slug is reserved");
  }
}
