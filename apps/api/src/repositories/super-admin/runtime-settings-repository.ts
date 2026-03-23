import { sql } from "drizzle-orm";
import { getDb } from "../../lib/db";

const AUTH_EMAIL_VERIFICATION_REQUIRED_KEY = "auth_email_verification_required";

type RuntimeBooleanSettingRow = {
  value: boolean | null;
  updatedBy: string | null;
  updatedAt: Date;
};

function isUndefinedTableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return String((error as { code: unknown }).code) === "42P01";
}

export class SuperAdminRuntimeSettingsRepository {
  async getAuthEmailVerificationRequired(): Promise<{
    value: boolean | null;
    source: "runtime" | "missing";
    updatedBy: string | null;
    updatedAt: Date | null;
  }> {
    const db = getDb();
    try {
      const result = await db.execute<RuntimeBooleanSettingRow>(sql`
        SELECT
          CASE
            WHEN jsonb_typeof(value_json) = 'boolean' THEN (value_json #>> '{}')::boolean
            ELSE NULL
          END AS "value",
          updated_by AS "updatedBy",
          updated_at AS "updatedAt"
        FROM system_runtime_settings
        WHERE setting_key = ${AUTH_EMAIL_VERIFICATION_REQUIRED_KEY}
        LIMIT 1
      `);

      const row = result.rows[0];
      if (!row) {
        return {
          value: null,
          source: "missing",
          updatedBy: null,
          updatedAt: null
        };
      }

      return {
        value: row.value,
        source: row.value === null ? "missing" : "runtime",
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt
      };
    } catch (error) {
      if (isUndefinedTableError(error)) {
        return {
          value: null,
          source: "missing",
          updatedBy: null,
          updatedAt: null
        };
      }
      throw error;
    }
  }

  async setAuthEmailVerificationRequired(input: {
    value: boolean;
    actor: string;
  }): Promise<{
    value: boolean;
    updatedBy: string | null;
    updatedAt: Date;
  }> {
    const db = getDb();
    const result = await db.execute<RuntimeBooleanSettingRow>(sql`
      INSERT INTO system_runtime_settings (
        setting_key,
        value_json,
        updated_by,
        updated_at
      ) VALUES (
        ${AUTH_EMAIL_VERIFICATION_REQUIRED_KEY},
        ${JSON.stringify(input.value)}::jsonb,
        ${input.actor},
        NOW()
      )
      ON CONFLICT (setting_key) DO UPDATE
      SET
        value_json = EXCLUDED.value_json,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING
        CASE
          WHEN jsonb_typeof(value_json) = 'boolean' THEN (value_json #>> '{}')::boolean
          ELSE NULL
        END AS "value",
        updated_by AS "updatedBy",
        updated_at AS "updatedAt"
    `);

    const row = result.rows[0];
    if (!row || row.value === null) {
      throw new Error("runtime_setting_update_failed");
    }

    return {
      value: row.value,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt
    };
  }
}
