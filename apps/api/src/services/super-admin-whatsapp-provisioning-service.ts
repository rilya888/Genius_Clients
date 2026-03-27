import { appError } from "../lib/http";
import { SuperAdminChannelEndpointRepository } from "../repositories/super-admin/channel-endpoint-repository";
import {
  SuperAdminWhatsAppProvisioningRepository,
  type OtpVerificationMethod,
  type ProvisioningJobRow,
  type ProvisioningJobStatus,
  type ProvisioningJobStep
} from "../repositories/super-admin/whatsapp-provisioning-repository";
import { TenantRepository } from "../repositories";

function normalizeE164(value: string): string {
  const normalized = value.replace(/[\s()-]/g, "").trim();
  if (!/^\+[1-9]\d{5,14}$/.test(normalized)) {
    throw appError("VALIDATION_ERROR", { reason: "whatsapp_e164_invalid" });
  }
  return normalized;
}

function parseStringMap(raw: string | undefined): Map<string, string> {
  const source = raw?.trim() ?? "";
  if (!source) {
    return new Map<string, string>();
  }
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return new Map<string, string>();
    }
    return new Map(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([k, v]) => k.trim().length > 0 && typeof v === "string" && v.trim().length > 0)
        .map(([k, v]) => [k.trim(), (v as string).trim()])
    );
  } catch {
    return new Map<string, string>();
  }
}

function parsePhoneMap(raw: string | undefined): Map<string, string> {
  const values = parseStringMap(raw);
  const normalized = new Map<string, string>();
  for (const [phone, phoneId] of values) {
    const cleanPhone = phone.replace(/[\s()-]/g, "").trim();
    if (/^\+[1-9]\d{5,14}$/.test(cleanPhone)) {
      normalized.set(cleanPhone, phoneId);
    }
  }
  return normalized;
}

type MetaApiResult = {
  ok: boolean;
  httpStatus: number;
  data: Record<string, unknown> | null;
  errorCode?: string;
  errorMessage?: string;
};

class MetaWhatsAppProvisionAdapter {
  private readonly graphVersion: string;
  private readonly fallbackToken: string;
  private readonly accessTokenByPhoneId: Map<string, string>;

  constructor() {
    this.graphVersion = process.env.WA_GRAPH_VERSION?.trim() || "v22.0";
    this.fallbackToken = process.env.WA_ACCESS_TOKEN?.trim() || "";
    this.accessTokenByPhoneId = parseStringMap(process.env.WA_ACCESS_TOKEN_BY_PHONE_JSON);
  }

  private resolveToken(phoneNumberId: string): string {
    const mapToken = this.accessTokenByPhoneId.get(phoneNumberId);
    if (mapToken?.trim()) {
      return mapToken.trim();
    }
    return this.fallbackToken;
  }

  private async post(input: {
    phoneNumberId: string;
    path: string;
    body: Record<string, unknown>;
  }): Promise<MetaApiResult> {
    const token = this.resolveToken(input.phoneNumberId);
    if (!token) {
      return {
        ok: false,
        httpStatus: 0,
        data: null,
        errorCode: "meta_token_missing",
        errorMessage: "WhatsApp access token is missing"
      };
    }

    const response = await fetch(`https://graph.facebook.com/${this.graphVersion}/${input.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input.body)
    });

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const error = payload?.error as { code?: number; message?: string } | undefined;
      return {
        ok: false,
        httpStatus: response.status,
        data: payload,
        errorCode: error?.code ? String(error.code) : "meta_api_error",
        errorMessage: error?.message ?? "Meta API request failed"
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      data: payload
    };
  }

  private async get(input: { phoneNumberId: string; path: string }): Promise<MetaApiResult> {
    const token = this.resolveToken(input.phoneNumberId);
    if (!token) {
      return {
        ok: false,
        httpStatus: 0,
        data: null,
        errorCode: "meta_token_missing",
        errorMessage: "WhatsApp access token is missing"
      };
    }

    const response = await fetch(`https://graph.facebook.com/${this.graphVersion}/${input.path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const error = payload?.error as { code?: number; message?: string } | undefined;
      return {
        ok: false,
        httpStatus: response.status,
        data: payload,
        errorCode: error?.code ? String(error.code) : "meta_api_error",
        errorMessage: error?.message ?? "Meta API request failed"
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      data: payload
    };
  }

  async requestOtp(input: { phoneNumberId: string; method: OtpVerificationMethod }) {
    return this.post({
      phoneNumberId: input.phoneNumberId,
      path: `${input.phoneNumberId}/request_code`,
      body: {
        code_method: input.method.toUpperCase(),
        language: "en_US"
      }
    });
  }

  async confirmOtp(input: { phoneNumberId: string; code: string }) {
    return this.post({
      phoneNumberId: input.phoneNumberId,
      path: `${input.phoneNumberId}/verify_code`,
      body: {
        code: input.code
      }
    });
  }

  async fetchPhoneProfile(phoneNumberId: string) {
    return this.get({
      phoneNumberId,
      path: `${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,waba_id,business_profile`
    });
  }
}

function resolveTokenSourceForPhone(phoneNumberId: string): "unknown" | "map" | "fallback" {
  const tokenMap = parseStringMap(process.env.WA_ACCESS_TOKEN_BY_PHONE_JSON);
  if (tokenMap.has(phoneNumberId)) {
    return "map";
  }
  if (process.env.WA_ACCESS_TOKEN?.trim()) {
    return "fallback";
  }
  return "unknown";
}

function normalizeChannelEnvironment(value: string | null | undefined): "sandbox" | "production" {
  return value === "sandbox" ? "sandbox" : "production";
}

function normalizeTemplateStatus(value: string | null | undefined): "unknown" | "not_ready" | "ready" {
  if (value === "not_ready" || value === "ready") {
    return value;
  }
  return "unknown";
}

function normalizeProfileStatus(value: string | null | undefined): "unknown" | "incomplete" | "ready" {
  if (value === "incomplete" || value === "ready") {
    return value;
  }
  return "unknown";
}

function sanitizeActor(actor: string | undefined): string {
  const normalized = actor?.trim();
  return normalized && normalized.length > 0 ? normalized.slice(0, 120) : "super_admin";
}

function buildJobKey(input: { tenantId: string; botNumberE164: string; operatorNumberE164: string }) {
  return `${input.tenantId}:${input.botNumberE164}:${input.operatorNumberE164}:${new Date().toISOString().slice(0, 16)}`;
}

function classifyMetaFailure(result: MetaApiResult): { status: ProvisioningJobStatus; errorCode: string; errorMessage: string } {
  if (result.httpStatus >= 500 || result.httpStatus === 429 || result.httpStatus === 0) {
    return {
      status: "failed_retryable",
      errorCode: result.errorCode ?? "meta_transient_error",
      errorMessage: result.errorMessage ?? "Transient Meta API error"
    };
  }
  return {
    status: "failed_final",
    errorCode: result.errorCode ?? "meta_request_failed",
    errorMessage: result.errorMessage ?? "Meta API request failed"
  };
}

export class SuperAdminWhatsAppProvisioningService {
  private readonly provisioningRepository = new SuperAdminWhatsAppProvisioningRepository();
  private readonly endpointRepository = new SuperAdminChannelEndpointRepository();
  private readonly tenantRepository = new TenantRepository();
  private readonly metaAdapter = new MetaWhatsAppProvisionAdapter();

  private resolvePhoneNumberId(input: { botNumberE164: string; explicitPhoneNumberId?: string | null }): string | null {
    if (input.explicitPhoneNumberId?.trim()) {
      return input.explicitPhoneNumberId.trim();
    }
    const phoneIdByE164 = parsePhoneMap(process.env.WA_PHONE_ID_BY_E164_JSON);
    const mapped = phoneIdByE164.get(input.botNumberE164);
    return mapped ?? null;
  }

  private async resolveEndpointByPhoneOrE164(input: {
    tenantId: string;
    phoneNumberId: string;
    botNumberE164: string;
  }) {
    const byPhone = await this.provisioningRepository.findConnectedEndpointByTenantAndPhone({
      tenantId: input.tenantId,
      phoneNumberId: input.phoneNumberId
    });
    if (byPhone) {
      return byPhone;
    }

    const all = await this.endpointRepository.listWhatsAppEndpointsByTenantIds([input.tenantId]);
    return all.find((item) => item.e164 === input.botNumberE164) ?? null;
  }

  private async setJobFailure(input: {
    jobId: string;
    tenantId: string;
    status: ProvisioningJobStatus;
    step: ProvisioningJobStep;
    errorCode: string;
    errorMessage: string;
    actor: string;
  }) {
    return this.provisioningRepository.updateJob({
      id: input.jobId,
      tenantId: input.tenantId,
      status: input.status,
      step: input.step,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      actor: input.actor
    });
  }

  async getStatus(tenantId: string) {
    const [activeJob, latestJob, activeBinding, latestBinding] = await Promise.all([
      this.provisioningRepository.getActiveJobByTenant(tenantId),
      this.provisioningRepository.getLatestJobByTenant(tenantId),
      this.provisioningRepository.getActiveBindingByTenant(tenantId),
      this.provisioningRepository.getLatestBindingByTenant(tenantId)
    ]);

    const targetJob = activeJob ?? latestJob;
    const otpSession = targetJob ? await this.provisioningRepository.getLatestOtpSessionByJob(targetJob.id) : null;

    return {
      activeJob,
      latestJob,
      otpSession,
      activeBinding,
      latestBinding
    };
  }

  async start(input: {
    tenantId: string;
    botNumber: string;
    operatorNumber: string;
    verificationMethod?: OtpVerificationMethod;
    actor?: string;
    phoneNumberId?: string;
  }): Promise<{ job: ProvisioningJobRow; requiresOtp: boolean }> {
    const actor = sanitizeActor(input.actor);
    const botNumberE164 = normalizeE164(input.botNumber);
    const operatorNumberE164 = normalizeE164(input.operatorNumber);

    if (botNumberE164 === operatorNumberE164) {
      throw appError("VALIDATION_ERROR", { reason: "whatsapp_numbers_must_be_different" });
    }

    const tenant = await this.provisioningRepository.findTenantById(input.tenantId);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND", { reason: "tenant_not_found" });
    }

    const activeJob = await this.provisioningRepository.getActiveJobByTenant(input.tenantId);
    if (activeJob) {
      throw appError("CONFLICT", { reason: "whatsapp_provisioning_job_already_active" });
    }

    const conflict = await this.endpointRepository.findActiveWhatsAppEndpointConflictByE164({
      tenantId: input.tenantId,
      e164: botNumberE164
    });
    if (conflict) {
      throw appError("CONFLICT", {
        reason: "desired_whatsapp_bot_e164_conflict",
        conflictTenantId: conflict.tenantId,
        conflictTenantName: conflict.tenantName
      });
    }

    const phoneNumberId = this.resolvePhoneNumberId({
      botNumberE164,
      explicitPhoneNumberId: input.phoneNumberId
    });

    if (!phoneNumberId) {
      throw appError("VALIDATION_ERROR", { reason: "meta_phone_number_id_not_resolved" });
    }

    const profile = await this.metaAdapter.fetchPhoneProfile(phoneNumberId);
    if (!profile.ok) {
      const failure = classifyMetaFailure(profile);
      const failedJob = await this.provisioningRepository.createJob({
        tenantId: input.tenantId,
        botNumberE164,
        operatorNumberE164,
        status: failure.status,
        step: "meta_prepare",
        jobKey: buildJobKey({ tenantId: input.tenantId, botNumberE164, operatorNumberE164 }),
        metaPayloadJson: {
          phoneNumberId,
          profileHttpStatus: profile.httpStatus
        },
        actor
      });
      await this.provisioningRepository.updateJob({
        id: failedJob.id,
        tenantId: input.tenantId,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        actor
      });
      throw appError("INTERNAL_ERROR", {
        reason: "meta_prepare_failed",
        metaErrorCode: failure.errorCode,
        metaErrorMessage: failure.errorMessage
      });
    }

    const endpoint = await this.resolveEndpointByPhoneOrE164({
      tenantId: input.tenantId,
      phoneNumberId,
      botNumberE164
    });

    const wabaId =
      (typeof profile.data?.waba_id === "string" && profile.data.waba_id.trim()) || endpoint?.wabaId || null;

    const job = await this.provisioningRepository.createJob({
      tenantId: input.tenantId,
      botNumberE164,
      operatorNumberE164,
      status: "otp_required",
      step: "otp_request",
      jobKey: buildJobKey({ tenantId: input.tenantId, botNumberE164, operatorNumberE164 }),
      metaPayloadJson: {
        phoneNumberId,
        wabaId,
        verificationMethod: input.verificationMethod ?? "sms"
      },
      actor
    });

    const tokenSource = resolveTokenSourceForPhone(phoneNumberId);
    const endpointUpsert = await this.endpointRepository.upsertWhatsAppEndpoint({
      id: endpoint?.id,
      tenantId: input.tenantId,
      accountId: endpoint?.accountId ?? tenant.id,
      salonId: endpoint?.salonId ?? tenant.id,
      externalEndpointId: phoneNumberId,
      environment: normalizeChannelEnvironment(endpoint?.environment),
      bindingStatus: "pending_verification",
      displayName: endpoint?.displayName ?? tenant.name,
      displayPhoneNumber:
        (typeof profile.data?.display_phone_number === "string" ? profile.data.display_phone_number : endpoint?.displayPhoneNumber) ??
        botNumberE164,
      e164: botNumberE164,
      verifiedName:
        (typeof profile.data?.verified_name === "string" ? profile.data.verified_name : endpoint?.verifiedName) ?? null,
      wabaId,
      businessId: endpoint?.businessId ?? null,
      tokenSource,
      templateStatus: normalizeTemplateStatus(endpoint?.templateStatus),
      profileStatus: normalizeProfileStatus(endpoint?.profileStatus),
      qualityRating:
        (typeof profile.data?.quality_rating === "string" ? profile.data.quality_rating : endpoint?.qualityRating) ?? null,
      metaStatus:
        (typeof profile.data?.name_status === "string" ? profile.data.name_status : endpoint?.metaStatus) ?? null,
      codeVerificationStatus:
        (typeof profile.data?.code_verification_status === "string"
          ? profile.data.code_verification_status
          : endpoint?.codeVerificationStatus) ?? null,
      notes: endpoint?.notes ?? null,
      isActive: true,
      connectedAt: endpoint?.connectedAt ?? null,
      disconnectedAt: null,
      lastInboundAt: endpoint?.lastInboundAt ?? null,
      lastOutboundAt: endpoint?.lastOutboundAt ?? null,
      actor
    });

    await this.provisioningRepository.createBindingCandidate({
      tenantId: input.tenantId,
      botNumberE164,
      operatorNumberE164,
      phoneNumberId,
      wabaId,
      businessId: endpointUpsert?.businessId ?? null,
      endpointId: endpointUpsert?.id ?? null,
      actor
    });

    await this.tenantRepository.updateSettings({
      tenantId: input.tenantId,
      desiredWhatsappBotE164: botNumberE164,
      operatorWhatsappE164: operatorNumberE164,
      adminNotificationWhatsappE164: operatorNumberE164
    });

    return { job, requiresOtp: true };
  }

  async requestOtp(input: {
    tenantId: string;
    jobId: string;
    verificationMethod?: OtpVerificationMethod;
    actor?: string;
  }) {
    const actor = sanitizeActor(input.actor);
    const job = await this.provisioningRepository.getJobByIdForTenant({ tenantId: input.tenantId, jobId: input.jobId });
    if (!job) {
      throw appError("TENANT_NOT_FOUND", { reason: "whatsapp_provisioning_job_not_found" });
    }

    if (job.status !== "otp_required" && job.status !== "failed_retryable") {
      throw appError("VALIDATION_ERROR", { reason: "whatsapp_provisioning_job_not_waiting_otp" });
    }

    const phoneNumberId = String(job.metaPayloadJson?.phoneNumberId ?? "").trim();
    if (!phoneNumberId) {
      throw appError("VALIDATION_ERROR", { reason: "meta_phone_number_id_not_resolved" });
    }

    const method = input.verificationMethod ?? (String(job.metaPayloadJson?.verificationMethod ?? "sms") as OtpVerificationMethod);
    if (method !== "sms" && method !== "voice") {
      throw appError("VALIDATION_ERROR", { reason: "verification_method_invalid" });
    }

    const result = await this.metaAdapter.requestOtp({ phoneNumberId, method });
    if (!result.ok) {
      const failure = classifyMetaFailure(result);
      await this.setJobFailure({
        jobId: job.id,
        tenantId: input.tenantId,
        status: failure.status,
        step: "otp_request",
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        actor
      });
      throw appError("INTERNAL_ERROR", {
        reason: "meta_request_otp_failed",
        metaErrorCode: failure.errorCode,
        metaErrorMessage: failure.errorMessage
      });
    }

    const session = await this.provisioningRepository.createOtpSession({
      jobId: job.id,
      verificationMethod: method,
      maskedTarget: null,
      state: "requested",
      otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    const updated = await this.provisioningRepository.updateJob({
      id: job.id,
      tenantId: input.tenantId,
      status: "otp_required",
      step: "otp_verify",
      metaPayloadJson: {
        ...(job.metaPayloadJson ?? {}),
        verificationMethod: method,
        lastOtpRequestedAt: new Date().toISOString()
      },
      errorCode: null,
      errorMessage: null,
      actor
    });

    return {
      job: updated ?? job,
      otpSession: session
    };
  }

  async confirmOtp(input: { tenantId: string; jobId: string; code: string; actor?: string }) {
    const actor = sanitizeActor(input.actor);
    const code = input.code.trim();
    if (!/^\d{4,8}$/.test(code)) {
      throw appError("VALIDATION_ERROR", { reason: "otp_code_invalid" });
    }

    const job = await this.provisioningRepository.getJobByIdForTenant({ tenantId: input.tenantId, jobId: input.jobId });
    if (!job) {
      throw appError("TENANT_NOT_FOUND", { reason: "whatsapp_provisioning_job_not_found" });
    }

    const otpSession = await this.provisioningRepository.getLatestOtpSessionByJob(job.id);
    if (!otpSession || otpSession.state !== "requested") {
      throw appError("VALIDATION_ERROR", { reason: "otp_session_not_requested" });
    }

    if (otpSession.attempts >= otpSession.maxAttempts) {
      await this.provisioningRepository.updateOtpSession({ id: otpSession.id, state: "failed" });
      await this.setJobFailure({
        jobId: job.id,
        tenantId: input.tenantId,
        status: "failed_final",
        step: "otp_verify",
        errorCode: "otp_attempts_exceeded",
        errorMessage: "Maximum OTP attempts exceeded",
        actor
      });
      throw appError("AUTH_FORBIDDEN", { reason: "otp_attempts_exceeded" });
    }

    const phoneNumberId = String(job.metaPayloadJson?.phoneNumberId ?? "").trim();
    if (!phoneNumberId) {
      throw appError("VALIDATION_ERROR", { reason: "meta_phone_number_id_not_resolved" });
    }

    const verify = await this.metaAdapter.confirmOtp({ phoneNumberId, code });
    if (!verify.ok) {
      const failure = classifyMetaFailure(verify);
      await this.provisioningRepository.updateOtpSession({
        id: otpSession.id,
        state: "requested",
        incrementAttempt: true
      });
      await this.setJobFailure({
        jobId: job.id,
        tenantId: input.tenantId,
        status: failure.status,
        step: "otp_verify",
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        actor
      });
      throw appError("INTERNAL_ERROR", {
        reason: "meta_verify_otp_failed",
        metaErrorCode: failure.errorCode,
        metaErrorMessage: failure.errorMessage
      });
    }

    await this.provisioningRepository.updateOtpSession({
      id: otpSession.id,
      state: "verified",
      incrementAttempt: true
    });

    const profile = await this.metaAdapter.fetchPhoneProfile(phoneNumberId);
    const endpoint = await this.provisioningRepository.findConnectedEndpointByTenantAndPhone({
      tenantId: input.tenantId,
      phoneNumberId
    });
    const wabaId =
      (profile.ok && typeof profile.data?.waba_id === "string" && profile.data.waba_id.trim()) ||
      String(job.metaPayloadJson?.wabaId ?? "").trim() ||
      endpoint?.wabaId ||
      null;

    const endpointUpsert = await this.endpointRepository.upsertWhatsAppEndpoint({
      id: endpoint?.id,
      tenantId: input.tenantId,
      accountId: endpoint?.accountId ?? input.tenantId,
      salonId: endpoint?.salonId ?? input.tenantId,
      externalEndpointId: phoneNumberId,
      environment: normalizeChannelEnvironment(endpoint?.environment),
      bindingStatus: "connected",
      displayName: endpoint?.displayName,
      displayPhoneNumber:
        (profile.ok && typeof profile.data?.display_phone_number === "string" ? profile.data.display_phone_number : endpoint?.displayPhoneNumber) ??
        job.botNumberE164,
      e164: job.botNumberE164,
      verifiedName:
        (profile.ok && typeof profile.data?.verified_name === "string" ? profile.data.verified_name : endpoint?.verifiedName) ?? null,
      wabaId,
      businessId: endpoint?.businessId ?? null,
      tokenSource: resolveTokenSourceForPhone(phoneNumberId),
      templateStatus: normalizeTemplateStatus(endpoint?.templateStatus),
      profileStatus: "ready",
      qualityRating:
        (profile.ok && typeof profile.data?.quality_rating === "string" ? profile.data.quality_rating : endpoint?.qualityRating) ?? null,
      metaStatus:
        (profile.ok && typeof profile.data?.name_status === "string" ? profile.data.name_status : endpoint?.metaStatus) ?? null,
      codeVerificationStatus:
        (profile.ok && typeof profile.data?.code_verification_status === "string"
          ? profile.data.code_verification_status
          : endpoint?.codeVerificationStatus) ?? "verified",
      notes: endpoint?.notes ?? null,
      isActive: true,
      connectedAt: new Date(),
      disconnectedAt: null,
      lastInboundAt: endpoint?.lastInboundAt ?? null,
      lastOutboundAt: endpoint?.lastOutboundAt ?? null,
      actor
    });

    const binding = await this.provisioningRepository.createBindingCandidate({
      tenantId: input.tenantId,
      botNumberE164: job.botNumberE164,
      operatorNumberE164: job.operatorNumberE164,
      phoneNumberId,
      wabaId,
      businessId: endpointUpsert?.businessId ?? null,
      endpointId: endpointUpsert?.id ?? null,
      actor
    });

    const activated = await this.provisioningRepository.activateBinding({
      tenantId: input.tenantId,
      bindingId: binding.id,
      actor
    });

    if (!activated) {
      await this.setJobFailure({
        jobId: job.id,
        tenantId: input.tenantId,
        status: "failed_retryable",
        step: "routing_update",
        errorCode: "binding_activation_failed",
        errorMessage: "Unable to activate new WhatsApp binding",
        actor
      });
      throw appError("INTERNAL_ERROR", { reason: "binding_activation_failed" });
    }

    await this.tenantRepository.updateSettings({
      tenantId: input.tenantId,
      desiredWhatsappBotE164: job.botNumberE164,
      operatorWhatsappE164: job.operatorNumberE164,
      adminNotificationWhatsappE164: job.operatorNumberE164
    });

    const updatedJob = await this.provisioningRepository.updateJob({
      id: job.id,
      tenantId: input.tenantId,
      status: "ready",
      step: "done",
      errorCode: null,
      errorMessage: null,
      metaPayloadJson: {
        ...(job.metaPayloadJson ?? {}),
        activatedBindingId: activated.id,
        activatedAt: new Date().toISOString()
      },
      actor
    });

    return {
      job: updatedJob ?? job,
      binding: activated
    };
  }

  async retry(input: { tenantId: string; jobId: string; actor?: string }) {
    const actor = sanitizeActor(input.actor);
    const job = await this.provisioningRepository.getJobByIdForTenant({ tenantId: input.tenantId, jobId: input.jobId });
    if (!job) {
      throw appError("TENANT_NOT_FOUND", { reason: "whatsapp_provisioning_job_not_found" });
    }

    if (job.status !== "failed_retryable") {
      throw appError("VALIDATION_ERROR", { reason: "whatsapp_provisioning_job_not_retryable" });
    }

    if (job.step === "otp_request" || job.step === "otp_verify") {
      const updated = await this.provisioningRepository.updateJob({
        id: job.id,
        tenantId: input.tenantId,
        status: "otp_required",
        step: job.step,
        errorCode: null,
        errorMessage: null,
        actor
      });
      return { job: updated ?? job, nextAction: job.step === "otp_request" ? "request_otp" : "confirm_otp" };
    }

    if (job.step === "meta_prepare") {
      const updated = await this.provisioningRepository.updateJob({
        id: job.id,
        tenantId: input.tenantId,
        status: "running",
        step: "meta_prepare",
        errorCode: null,
        errorMessage: null,
        actor
      });
      return { job: updated ?? job, nextAction: "start_again" };
    }

    const updated = await this.provisioningRepository.updateJob({
      id: job.id,
      tenantId: input.tenantId,
      status: "running",
      step: "routing_update",
      errorCode: null,
      errorMessage: null,
      actor
    });

    return { job: updated ?? job, nextAction: "confirm_otp" };
  }
}
