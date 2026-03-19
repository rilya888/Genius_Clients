import { sql } from "drizzle-orm";
import { getDb } from "../../lib/db";

export type SuperAdminAuditLogRow = {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  beforeJson: unknown;
  afterJson: unknown;
  requestId: string | null;
  createdAt: Date;
};

export class SuperAdminAuditRepository {
  async listAuditLog(limit = 200): Promise<SuperAdminAuditLogRow[]> {
    const db = getDb();
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);

    const result = await db.execute(sql<SuperAdminAuditLogRow>`
      SELECT
        id,
        actor,
        action,
        entity,
        entity_id AS "entityId",
        before_json AS "beforeJson",
        after_json AS "afterJson",
        request_id AS "requestId",
        created_at AS "createdAt"
      FROM super_admin_audit_log
      ORDER BY created_at DESC
      LIMIT ${normalizedLimit}
    `);

    return result.rows as unknown as SuperAdminAuditLogRow[];
  }

  async createLog(input: {
    actor: string;
    action: string;
    entity: string;
    entityId: string;
    beforeJson?: unknown;
    afterJson?: unknown;
    requestId?: string;
  }): Promise<void> {
    const db = getDb();

    await db.execute(sql`
      INSERT INTO super_admin_audit_log (
        actor,
        action,
        entity,
        entity_id,
        before_json,
        after_json,
        request_id,
        created_at
      ) VALUES (
        ${input.actor},
        ${input.action},
        ${input.entity},
        ${input.entityId},
        ${JSON.stringify(input.beforeJson ?? null)}::jsonb,
        ${JSON.stringify(input.afterJson ?? null)}::jsonb,
        ${input.requestId ?? null},
        NOW()
      )
    `);
  }
}
