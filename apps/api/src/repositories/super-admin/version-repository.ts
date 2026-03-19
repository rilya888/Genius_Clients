import { sql } from "drizzle-orm";
import { getDb } from "../../lib/db";

export type SuperAdminPlanVersionRow = {
  id: string;
  version: number;
  status: "draft" | "published" | "archived";
  publishedAt: Date | null;
  publishedBy: string | null;
  snapshotJson: unknown;
  createdAt: Date;
};

export class SuperAdminVersionRepository {
  async listVersions(limit = 50): Promise<SuperAdminPlanVersionRow[]> {
    const db = getDb();
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);

    const result = await db.execute(sql<SuperAdminPlanVersionRow>`
      SELECT
        id,
        version,
        status,
        published_at AS "publishedAt",
        published_by AS "publishedBy",
        snapshot_json AS "snapshotJson",
        created_at AS "createdAt"
      FROM subscription_plan_versions
      ORDER BY version DESC
      LIMIT ${normalizedLimit}
    `);

    return result.rows as unknown as SuperAdminPlanVersionRow[];
  }

  async getByVersion(version: number): Promise<SuperAdminPlanVersionRow | null> {
    const db = getDb();
    const result = await db.execute(sql<SuperAdminPlanVersionRow>`
      SELECT
        id,
        version,
        status,
        published_at AS "publishedAt",
        published_by AS "publishedBy",
        snapshot_json AS "snapshotJson",
        created_at AS "createdAt"
      FROM subscription_plan_versions
      WHERE version = ${version}
      LIMIT 1
    `);

    return (result.rows[0] as SuperAdminPlanVersionRow | undefined) ?? null;
  }

  async getLatestPublished(): Promise<SuperAdminPlanVersionRow | null> {
    const db = getDb();
    const result = await db.execute(sql<SuperAdminPlanVersionRow>`
      SELECT
        id,
        version,
        status,
        published_at AS "publishedAt",
        published_by AS "publishedBy",
        snapshot_json AS "snapshotJson",
        created_at AS "createdAt"
      FROM subscription_plan_versions
      WHERE status = 'published'
      ORDER BY version DESC
      LIMIT 1
    `);

    return (result.rows[0] as SuperAdminPlanVersionRow | undefined) ?? null;
  }

  async createPublishedVersion(input: {
    snapshotJson: unknown;
    publishedBy: string;
  }): Promise<SuperAdminPlanVersionRow> {
    const db = getDb();
    const nextVersionResult = await db.execute<{ nextVersion: number }>(sql`
      SELECT COALESCE(MAX(version), 0) + 1 AS "nextVersion"
      FROM subscription_plan_versions
    `);

    const nextVersion = Number(nextVersionResult.rows[0]?.nextVersion ?? 1);

    const result = await db.execute(sql<SuperAdminPlanVersionRow>`
      INSERT INTO subscription_plan_versions (
        version,
        status,
        published_at,
        published_by,
        snapshot_json,
        created_at
      ) VALUES (
        ${nextVersion},
        'published',
        NOW(),
        ${input.publishedBy},
        ${JSON.stringify(input.snapshotJson)}::jsonb,
        NOW()
      )
      RETURNING
        id,
        version,
        status,
        published_at AS "publishedAt",
        published_by AS "publishedBy",
        snapshot_json AS "snapshotJson",
        created_at AS "createdAt"
    `);

    return result.rows[0] as unknown as SuperAdminPlanVersionRow;
  }
}
