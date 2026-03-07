import { createDbClient } from "@genius/db";
import { getRequiredEnv } from "@genius/shared";

let cachedDb: ReturnType<typeof createDbClient> | null = null;

export function getDb() {
  if (cachedDb) {
    return cachedDb;
  }

  const databaseUrl = getRequiredEnv("DATABASE_URL");
  cachedDb = createDbClient(databaseUrl);
  return cachedDb;
}
