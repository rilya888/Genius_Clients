import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const checks = [
  {
    file: "apps/web-vite/dist/index.html",
    required: ["Genius Clients | Booking Platform for Modern Salons", "rel=\"canonical\"", "hreflang=\"en\""]
  },
  {
    file: "apps/web-vite/dist/pricing/index.html",
    required: ["Pricing | Genius Clients", "og:title", "rel=\"canonical\""]
  },
  {
    file: "apps/web-vite/dist/faq/index.html",
    required: ["FAQ | Genius Clients", "og:description", "hreflang=\"it\""]
  }
];

for (const check of checks) {
  const absolutePath = resolve(root, check.file);
  const content = await readFile(absolutePath, "utf8");
  for (const token of check.required) {
    if (!content.includes(token)) {
      throw new Error(`Missing token \"${token}\" in ${check.file}`);
    }
  }
}

console.log("web-vite prerender smoke: OK");
