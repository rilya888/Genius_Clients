export type EnvironmentName = "development" | "staging" | "production";
export * from "./slug";
export * from "./validation";
export * from "./monitoring";
export * from "./action-token";
export * from "./tenant-host";

export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getEnvironmentName(): EnvironmentName {
  const raw = process.env.NODE_ENV;
  if (raw === "production") return "production";
  if (raw === "staging") return "staging";
  return "development";
}
