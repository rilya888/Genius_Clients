import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export function createDbClient(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10
  });

  return drizzle(pool);
}
