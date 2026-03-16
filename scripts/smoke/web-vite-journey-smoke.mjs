import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();

async function expectContains(file, tokens) {
  const full = resolve(root, file);
  const content = await readFile(full, "utf8");
  for (const token of tokens) {
    if (!content.includes(token)) {
      throw new Error(`Missing token '${token}' in ${file}`);
    }
  }
}

await expectContains("apps/web-vite/src/app/App.tsx", [
  'path="/register"',
  'path="/login"',
  'path="/book"',
  'path="/app"'
]);

await expectContains("apps/web-vite/src/shared/api/authApi.ts", [
  "export async function register",
  "export async function login"
]);

await expectContains("apps/web-vite/src/shared/api/publicApi.ts", [
  "export async function listPublicSlots",
  "export async function createPublicBooking"
]);

await expectContains("apps/web-vite/src/pages/PublicBookingPage.tsx", [
  "createPublicBooking(",
  "booking.step.selection",
  "booking.step.client"
]);

console.log("web-vite journey smoke: OK");
