import {
  channelEndpointsV2,
  tenants,
  whatsappNumberProvisioningJobs,
  whatsappOtpSessions,
  whatsappTenantBindings
} from "@genius/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../lib/db";

export type ProvisioningJobStatus =
  | "draft"
  | "running"
  | "otp_required"
  | "ready"
  | "failed_retryable"
  | "failed_final"
  | "rolled_back";

export type ProvisioningJobStep =
  | "validating"
  | "meta_prepare"
  | "otp_request"
  | "otp_verify"
  | "routing_update"
  | "healthcheck"
  | "done";

export type OtpVerificationMethod = "sms" | "voice";
export type OtpSessionState = "created" | "requested" | "verified" | "expired" | "failed";

export type ProvisioningJobRow = {
  id: string;
  tenantId: string;
  botNumberE164: string;
  operatorNumberE164: string;
  status: ProvisioningJobStatus;
  step: ProvisioningJobStep;
  jobKey: string;
  metaPayloadJson: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OtpSessionRow = {
  id: string;
  jobId: string;
  verificationMethod: OtpVerificationMethod;
  maskedTarget: string | null;
  state: OtpSessionState;
  attempts: number;
  maxAttempts: number;
  otpExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TenantBindingRow = {
  id: string;
  tenantId: string;
  botNumberE164: string;
  operatorNumberE164: string;
  phoneNumberId: string;
  wabaId: string | null;
  businessId: string | null;
  endpointId: string | null;
  bindingVersion: number;
  isActive: boolean;
  verifiedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeJobRow(
  row: Omit<ProvisioningJobRow, "status" | "step" | "metaPayloadJson"> & {
    status: string;
    step: string;
    metaPayloadJson: unknown;
  }
): ProvisioningJobRow {
  return {
    ...row,
    status: row.status as ProvisioningJobStatus,
    step: row.step as ProvisioningJobStep,
    metaPayloadJson:
      row.metaPayloadJson && typeof row.metaPayloadJson === "object"
        ? (row.metaPayloadJson as Record<string, unknown>)
        : null
  };
}

function normalizeOtpRow(
  row: Omit<OtpSessionRow, "verificationMethod" | "state"> & {
    verificationMethod: string;
    state: string;
  }
): OtpSessionRow {
  return {
    ...row,
    verificationMethod: row.verificationMethod as OtpVerificationMethod,
    state: row.state as OtpSessionState
  };
}

export class SuperAdminWhatsAppProvisioningRepository {
  async getActiveJobByTenant(tenantId: string): Promise<ProvisioningJobRow | null> {
    const db = getDb();
    const items = await db
      .select()
      .from(whatsappNumberProvisioningJobs)
      .where(
        and(
          eq(whatsappNumberProvisioningJobs.tenantId, tenantId),
          sql`${whatsappNumberProvisioningJobs.status} in ('draft', 'running', 'otp_required', 'failed_retryable')`
        )
      )
      .orderBy(desc(whatsappNumberProvisioningJobs.updatedAt), desc(whatsappNumberProvisioningJobs.createdAt))
      .limit(1);
    return items[0] ? normalizeJobRow(items[0]) : null;
  }

  async getLatestJobByTenant(tenantId: string): Promise<ProvisioningJobRow | null> {
    const db = getDb();
    const items = await db
      .select()
      .from(whatsappNumberProvisioningJobs)
      .where(eq(whatsappNumberProvisioningJobs.tenantId, tenantId))
      .orderBy(desc(whatsappNumberProvisioningJobs.createdAt))
      .limit(1);
    return items[0] ? normalizeJobRow(items[0]) : null;
  }

  async getJobByIdForTenant(input: { tenantId: string; jobId: string }): Promise<ProvisioningJobRow | null> {
    const db = getDb();
    const items = await db
      .select()
      .from(whatsappNumberProvisioningJobs)
      .where(
        and(
          eq(whatsappNumberProvisioningJobs.id, input.jobId),
          eq(whatsappNumberProvisioningJobs.tenantId, input.tenantId)
        )
      )
      .limit(1);
    return items[0] ? normalizeJobRow(items[0]) : null;
  }

  async createJob(input: {
    tenantId: string;
    botNumberE164: string;
    operatorNumberE164: string;
    status: ProvisioningJobStatus;
    step: ProvisioningJobStep;
    jobKey: string;
    metaPayloadJson?: Record<string, unknown> | null;
    actor?: string | null;
  }): Promise<ProvisioningJobRow> {
    const db = getDb();
    const [created] = await db
      .insert(whatsappNumberProvisioningJobs)
      .values({
        tenantId: input.tenantId,
        botNumberE164: input.botNumberE164,
        operatorNumberE164: input.operatorNumberE164,
        status: input.status,
        step: input.step,
        jobKey: input.jobKey,
        metaPayloadJson: input.metaPayloadJson ?? null,
        createdBy: input.actor ?? null,
        updatedBy: input.actor ?? null
      })
      .returning();
    if (!created) {
      throw new Error("whatsapp_provisioning_job_create_failed");
    }

    return normalizeJobRow(created);
  }

  async updateJob(input: {
    id: string;
    tenantId: string;
    status?: ProvisioningJobStatus;
    step?: ProvisioningJobStep;
    botNumberE164?: string;
    operatorNumberE164?: string;
    metaPayloadJson?: Record<string, unknown> | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    nextRetryAt?: Date | null;
    actor?: string | null;
  }): Promise<ProvisioningJobRow | null> {
    const db = getDb();
    const [updated] = await db
      .update(whatsappNumberProvisioningJobs)
      .set({
        status: input.status,
        step: input.step,
        botNumberE164: input.botNumberE164,
        operatorNumberE164: input.operatorNumberE164,
        metaPayloadJson: input.metaPayloadJson,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        nextRetryAt: input.nextRetryAt,
        updatedBy: input.actor ?? null,
        updatedAt: new Date(),
        lastAttemptAt: new Date(),
        attempts: sql`${whatsappNumberProvisioningJobs.attempts} + 1`
      })
      .where(
        and(
          eq(whatsappNumberProvisioningJobs.id, input.id),
          eq(whatsappNumberProvisioningJobs.tenantId, input.tenantId)
        )
      )
      .returning();
    if (!updated) {
      return null;
    }

    return normalizeJobRow(updated);
  }

  async createOtpSession(input: {
    jobId: string;
    verificationMethod: OtpVerificationMethod;
    maskedTarget?: string | null;
    state: OtpSessionState;
    maxAttempts?: number;
    otpExpiresAt?: Date | null;
  }): Promise<OtpSessionRow> {
    const db = getDb();
    const [created] = await db
      .insert(whatsappOtpSessions)
      .values({
        jobId: input.jobId,
        verificationMethod: input.verificationMethod,
        maskedTarget: input.maskedTarget ?? null,
        state: input.state,
        maxAttempts: input.maxAttempts ?? 5,
        otpExpiresAt: input.otpExpiresAt ?? null
      })
      .returning();
    if (!created) {
      throw new Error("whatsapp_otp_session_create_failed");
    }
    return normalizeOtpRow(created);
  }

  async getLatestOtpSessionByJob(jobId: string): Promise<OtpSessionRow | null> {
    const db = getDb();
    const items = await db
      .select()
      .from(whatsappOtpSessions)
      .where(eq(whatsappOtpSessions.jobId, jobId))
      .orderBy(desc(whatsappOtpSessions.createdAt))
      .limit(1);
    return items[0] ? normalizeOtpRow(items[0]) : null;
  }

  async updateOtpSession(input: {
    id: string;
    state?: OtpSessionState;
    maskedTarget?: string | null;
    otpExpiresAt?: Date | null;
    incrementAttempt?: boolean;
  }): Promise<OtpSessionRow | null> {
    const db = getDb();
    const [updated] = await db
      .update(whatsappOtpSessions)
      .set({
        state: input.state,
        maskedTarget: input.maskedTarget,
        otpExpiresAt: input.otpExpiresAt,
        updatedAt: new Date(),
        attempts: input.incrementAttempt ? sql`${whatsappOtpSessions.attempts} + 1` : undefined
      })
      .where(eq(whatsappOtpSessions.id, input.id))
      .returning();
    if (!updated) {
      return null;
    }
    return normalizeOtpRow(updated);
  }

  async getActiveBindingByTenant(tenantId: string): Promise<TenantBindingRow | null> {
    const db = getDb();
    const items = await db
      .select()
      .from(whatsappTenantBindings)
      .where(and(eq(whatsappTenantBindings.tenantId, tenantId), eq(whatsappTenantBindings.isActive, true)))
      .limit(1);
    return items[0] ?? null;
  }

  async getLatestBindingByTenant(tenantId: string): Promise<TenantBindingRow | null> {
    const db = getDb();
    const items = await db
      .select()
      .from(whatsappTenantBindings)
      .where(eq(whatsappTenantBindings.tenantId, tenantId))
      .orderBy(desc(whatsappTenantBindings.bindingVersion), desc(whatsappTenantBindings.createdAt))
      .limit(1);
    return items[0] ?? null;
  }

  async listBindingsByTenant(tenantId: string, limit = 20): Promise<TenantBindingRow[]> {
    const db = getDb();
    return db
      .select()
      .from(whatsappTenantBindings)
      .where(eq(whatsappTenantBindings.tenantId, tenantId))
      .orderBy(desc(whatsappTenantBindings.bindingVersion), desc(whatsappTenantBindings.createdAt))
      .limit(limit);
  }

  async createBindingCandidate(input: {
    tenantId: string;
    botNumberE164: string;
    operatorNumberE164: string;
    phoneNumberId: string;
    wabaId?: string | null;
    businessId?: string | null;
    endpointId?: string | null;
    actor?: string | null;
  }): Promise<TenantBindingRow> {
    const db = getDb();
    const nextVersionRow = await db
      .select({ nextVersion: sql<number>`coalesce(max(${whatsappTenantBindings.bindingVersion}), 0)::int + 1` })
      .from(whatsappTenantBindings)
      .where(eq(whatsappTenantBindings.tenantId, input.tenantId));
    const nextVersion = nextVersionRow[0]?.nextVersion ?? 1;

    const [created] = await db
      .insert(whatsappTenantBindings)
      .values({
        tenantId: input.tenantId,
        botNumberE164: input.botNumberE164,
        operatorNumberE164: input.operatorNumberE164,
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId ?? null,
        businessId: input.businessId ?? null,
        endpointId: input.endpointId ?? null,
        bindingVersion: nextVersion,
        isActive: false,
        createdBy: input.actor ?? null,
        updatedBy: input.actor ?? null
      })
      .onConflictDoUpdate({
        target: [whatsappTenantBindings.phoneNumberId],
        set: {
          tenantId: input.tenantId,
          botNumberE164: input.botNumberE164,
          operatorNumberE164: input.operatorNumberE164,
          wabaId: input.wabaId ?? null,
          businessId: input.businessId ?? null,
          endpointId: input.endpointId ?? null,
          isActive: false,
          updatedBy: input.actor ?? null,
          updatedAt: new Date()
        }
      })
      .returning();
    if (!created) {
      throw new Error("whatsapp_tenant_binding_create_failed");
    }

    return created;
  }

  async activateBinding(input: { tenantId: string; bindingId: string; actor?: string | null }) {
    const db = getDb();

    return db.transaction(async (tx) => {
      await tx
        .update(whatsappTenantBindings)
        .set({
          isActive: false,
          updatedAt: new Date(),
          updatedBy: input.actor ?? null
        })
        .where(eq(whatsappTenantBindings.tenantId, input.tenantId));

      const [activated] = await tx
        .update(whatsappTenantBindings)
        .set({
          isActive: true,
          verifiedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: input.actor ?? null
        })
        .where(
          and(
            eq(whatsappTenantBindings.id, input.bindingId),
            eq(whatsappTenantBindings.tenantId, input.tenantId)
          )
        )
        .returning();

      return activated ?? null;
    });
  }

  async findTenantById(tenantId: string) {
    const db = getDb();
    const items = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return items[0] ?? null;
  }

  async findConnectedEndpointByTenantAndPhone(input: { tenantId: string; phoneNumberId: string }) {
    const db = getDb();
    const items = await db
      .select()
      .from(channelEndpointsV2)
      .where(
        and(
          eq(channelEndpointsV2.tenantId, input.tenantId),
          eq(channelEndpointsV2.provider, "whatsapp"),
          eq(channelEndpointsV2.externalEndpointId, input.phoneNumberId),
          eq(channelEndpointsV2.isActive, true)
        )
      )
      .orderBy(desc(channelEndpointsV2.updatedAt))
      .limit(1);
    return items[0] ?? null;
  }
}
