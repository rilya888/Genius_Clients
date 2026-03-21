import { and, eq } from "drizzle-orm";
import { stripeCustomers } from "@genius/db";
import { getDb } from "../lib/db";

export class StripeRepository {
  async upsertCustomer(input: {
    tenantId: string;
    stripeCustomerId: string;
    email?: string | null;
    userId?: string | null;
  }) {
    const db = getDb();
    const [record] = await db
      .insert(stripeCustomers)
      .values({
        tenantId: input.tenantId,
        stripeCustomerId: input.stripeCustomerId,
        email: input.email ?? null,
        userId: input.userId ?? null
      })
      .onConflictDoUpdate({
        target: [stripeCustomers.stripeCustomerId],
        set: {
          tenantId: input.tenantId,
          email: input.email ?? null,
          userId: input.userId ?? null,
          updatedAt: new Date()
        }
      })
      .returning();

    return record ?? null;
  }

  async listByTenant(tenantId: string, limit = 100) {
    const db = getDb();
    return db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.tenantId, tenantId))
      .limit(Math.min(Math.max(limit, 1), 500));
  }

  async findByTenantAndStripeId(tenantId: string, stripeCustomerId: string) {
    const db = getDb();
    const [record] = await db
      .select()
      .from(stripeCustomers)
      .where(
        and(
          eq(stripeCustomers.tenantId, tenantId),
          eq(stripeCustomers.stripeCustomerId, stripeCustomerId)
        )
      )
      .limit(1);

    return record ?? null;
  }

  async findByStripeCustomerId(stripeCustomerId: string) {
    const db = getDb();
    const [record] = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.stripeCustomerId, stripeCustomerId))
      .limit(1);

    return record ?? null;
  }
}
