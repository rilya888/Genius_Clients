import { httpJson } from "./http";

type ProbeResponse = {
  data?: unknown;
};

async function probe(path: string) {
  await httpJson<ProbeResponse>(path, { method: "GET" });
  return "ok" as const;
}

export async function loadSystemStatus() {
  const [health, ready] = await Promise.allSettled([probe("/api/v1/health"), probe("/api/v1/ready")]);

  return {
    health: health.status === "fulfilled" ? "ok" : "error",
    ready: ready.status === "fulfilled" ? "ok" : "error"
  } as const;
}
