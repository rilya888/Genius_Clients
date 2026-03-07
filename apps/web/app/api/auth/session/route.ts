import { resolveSessionResponse } from "../../../../lib/session-route";

export async function GET() {
  return resolveSessionResponse();
}
