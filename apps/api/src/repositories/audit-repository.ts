import { auditLogs } from "@genius/db";
import { getDb } from "../lib/db";

export class AuditRepository {
  async create(input: {
    tenantId: string;
    actorUserId?: string;
    action: string;
    entity: string;
    entityId?: string;
    meta?: unknown;
  }) {
    const db = getDb();
    const [record] = await db
      .insert(auditLogs)
      .values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        meta: input.meta
      })
      .returning();

    return record ?? null;
  }
}

