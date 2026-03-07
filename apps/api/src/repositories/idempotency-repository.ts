import { and, eq } from "drizzle-orm";
import { idempotencyKeys } from "@genius/db";
import { getDb } from "../lib/db";

export class IdempotencyRepository {
  async find(tenantId: string, key: string) {
    const db = getDb();
    const [record] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.key, key)))
      .limit(1);

    return record ?? null;
  }

  async create(input: {
    tenantId: string;
    key: string;
    requestHash: string;
    responseCode: number;
    responseBody: unknown;
    expiresAt: Date;
  }) {
    const db = getDb();
    const [record] = await db
      .insert(idempotencyKeys)
      .values({
        tenantId: input.tenantId,
        key: input.key,
        requestHash: input.requestHash,
        responseCode: input.responseCode,
        responseBody: input.responseBody,
        expiresAt: input.expiresAt
      })
      .returning();

    return record;
  }
}
