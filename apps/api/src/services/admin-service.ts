import { appError } from "../lib/http";
import { computeWhatsAppSetupSummary } from "../lib/whatsapp-setup";
import { captureException } from "@genius/shared";
import {
  AuditRepository,
  AdminRepository,
  BookingRepository,
  NotificationRepository,
  StripeRepository,
  TenantRepository
} from "../repositories";
import { SubscriptionGovernanceService } from "./subscription-governance-service";
import { SuperAdminChannelEndpointRepository } from "../repositories/super-admin/channel-endpoint-repository";

export class AdminService {
  private readonly adminRepository = new AdminRepository();
  private readonly tenantRepository = new TenantRepository();
  private readonly auditRepository = new AuditRepository();
  private readonly notificationRepository = new NotificationRepository();
  private readonly stripeRepository = new StripeRepository();
  private readonly bookingRepository = new BookingRepository();
  private readonly subscriptionGovernanceService = new SubscriptionGovernanceService();
  private readonly channelEndpointRepository = new SuperAdminChannelEndpointRepository();
  private readonly e164Pattern = /^\+[1-9]\d{5,14}$/;

  private assertMinuteRange(startMinute: number, endMinute: number) {
    if (
      !Number.isInteger(startMinute) ||
      !Number.isInteger(endMinute) ||
      startMinute < 0 ||
      endMinute > 1440 ||
      startMinute >= endMinute
    ) {
      throw appError("VALIDATION_ERROR", { reason: "minute_range_invalid" });
    }
  }

  private normalizeOptionalText(value: string | null | undefined) {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private validateOptionalE164(value: string | null | undefined, reason: string) {
    const normalized = this.normalizeOptionalText(value);
    if (normalized && !this.e164Pattern.test(normalized)) {
      throw appError("VALIDATION_ERROR", { reason });
    }
    return normalized;
  }

  private assertValidTimezone(timezone: string, reason: string) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format(new Date());
    } catch {
      throw appError("VALIDATION_ERROR", { reason });
    }
  }

  async getDashboard(input: { tenantId: string }) {
    const tenant = await this.tenantRepository.findById(input.tenantId);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND");
    }

    const [kpis, attention, recentActivity, endpoints] = await Promise.all([
      this.adminRepository.getDashboardKpis({
        tenantId: input.tenantId,
        timezone: tenant.timezone
      }),
      this.adminRepository.getDashboardAttention({
        tenantId: input.tenantId
      }),
      this.adminRepository.listRecentActivity({
        tenantId: input.tenantId,
        limit: 10
      }),
      this.channelEndpointRepository.listWhatsAppEndpointsByTenantIds([input.tenantId])
    ]);

    const botNumberConflict = tenant.desiredWhatsappBotE164
      ? await this.channelEndpointRepository.findActiveWhatsAppEndpointConflictByE164({
          tenantId: input.tenantId,
          e164: tenant.desiredWhatsappBotE164
        })
      : null;
    const whatsappSetup = computeWhatsAppSetupSummary({
      desiredBotNumber: tenant.desiredWhatsappBotE164,
      operatorNumber: tenant.operatorWhatsappE164,
      endpoints,
      hasBotNumberConflict: Boolean(botNumberConflict)
    });

    return {
      kpis: {
        bookingsTodayTotal: Number(kpis?.bookingsTodayTotal ?? 0),
        bookingsWeekTotal: Number(kpis?.bookingsWeekTotal ?? 0),
        bookingsPendingCount: Number(kpis?.bookingsPendingCount ?? 0),
        bookingsCancelledWeek: Number(kpis?.bookingsCancelledWeek ?? 0),
        staffActiveCount: Number(kpis?.staffActiveCount ?? 0),
        bookedMinutesToday: Number(kpis?.bookedMinutesToday ?? 0),
        bookingsNoShowToday: Number(kpis?.bookingsNoShowToday ?? 0),
        completedRevenueTodayMinor: Number(kpis?.completedRevenueTodayMinor ?? 0)
      },
      attention: {
        servicesWithoutMasters: Number(attention.servicesWithoutMasters ?? 0),
        mastersWithoutSchedule: Number(attention.mastersWithoutSchedule ?? 0),
        pendingBookings: Number(attention.pendingBookings ?? 0)
      },
      recentActivity,
      whatsappSetup
    };
  }

  async listNotificationDeliveries(input: { tenantId: string; limit?: number }) {
    const limitRaw = input.limit ?? 50;
    const limit = Math.min(Math.max(Number(limitRaw) || 50, 1), 200);
    return this.adminRepository.listNotificationDeliveries({
      tenantId: input.tenantId,
      limit
    });
  }

  async listStripeCustomers(input: { tenantId: string; limit?: number }) {
    const limitRaw = input.limit ?? 100;
    const limit = Math.min(Math.max(Number(limitRaw) || 100, 1), 500);
    return this.stripeRepository.listByTenant(input.tenantId, limit);
  }

  async getNotificationDeliverySummary(tenantId: string) {
    return this.adminRepository.getNotificationDeliverySummary(tenantId);
  }

  async retryFailedNotificationDeliveries(input: {
    tenantId: string;
    limit?: number;
    actorUserId?: string;
    requestId?: string;
  }) {
    const limitRaw = input.limit ?? 100;
    const limit = Math.min(Math.max(Number(limitRaw) || 100, 1), 500);
    const queued = await this.notificationRepository.resetFailedToQueued(input.tenantId, limit);

    await this.auditRepository.create({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "notification_retry_failed_requested",
      entity: "notification_delivery",
      meta: {
        limit,
        queued,
        requestId: input.requestId
      }
    });

    return { queued };
  }

  async listMasters(tenantId: string) {
    return this.adminRepository.listMasters(tenantId);
  }

  async createMaster(input: { tenantId: string; displayName: string; isActive?: boolean }) {
    const displayName = input.displayName.trim();
    if (!displayName) {
      throw appError("VALIDATION_ERROR", { reason: "display_name_required" });
    }

    const existing = await this.adminRepository.findMasterByDisplayName({
      tenantId: input.tenantId,
      displayName
    });
    if (existing) {
      throw appError("CONFLICT", { reason: "master_display_name_already_exists" });
    }

    await this.subscriptionGovernanceService.enforceCanCreateMaster(input.tenantId);

    const created = await this.adminRepository.createMaster({
      tenantId: input.tenantId,
      displayName,
      isActive: input.isActive
    });

    if (!created) {
      throw appError("INTERNAL_ERROR", { reason: "master_create_failed" });
    }

    return created;
  }

  async updateMaster(input: {
    tenantId: string;
    masterId: string;
    displayName: string;
    isActive: boolean;
    forceDeactivate?: boolean;
  }) {
    const displayName = input.displayName.trim();
    if (!displayName) {
      throw appError("VALIDATION_ERROR", { reason: "display_name_required" });
    }

    const existing = await this.adminRepository.findMasterByDisplayName({
      tenantId: input.tenantId,
      displayName,
      excludeMasterId: input.masterId
    });
    if (existing) {
      throw appError("CONFLICT", { reason: "master_display_name_already_exists" });
    }

    if (!input.isActive) {
      const impact = await this.getMasterDeactivationImpact({
        tenantId: input.tenantId,
        masterId: input.masterId
      });
      if (impact.upcomingConfirmedCount > 0 && !input.forceDeactivate) {
        throw appError("VALIDATION_ERROR", {
          reason: "master_has_confirmed_bookings",
          upcomingConfirmedCount: impact.upcomingConfirmedCount,
          earliestStartAt: impact.earliestStartAt
        });
      }
    }

    const updated = await this.adminRepository.updateMaster({
      tenantId: input.tenantId,
      masterId: input.masterId,
      displayName,
      isActive: input.isActive
    });

    if (!updated) {
      throw appError("TENANT_NOT_FOUND", { reason: "master_not_found_in_tenant" });
    }

    return updated;
  }

  async getMasterDeactivationImpact(input: { tenantId: string; masterId: string }) {
    return this.bookingRepository.getUpcomingConfirmedImpactByMaster({
      tenantId: input.tenantId,
      masterId: input.masterId,
      now: new Date()
    });
  }

  async deleteMaster(input: { tenantId: string; masterId: string }) {
    const impact = await this.getMasterDeactivationImpact({
      tenantId: input.tenantId,
      masterId: input.masterId
    });
    if (impact.upcomingConfirmedCount > 0) {
      throw appError("VALIDATION_ERROR", {
        reason: "master_has_confirmed_bookings",
        upcomingConfirmedCount: impact.upcomingConfirmedCount,
        earliestStartAt: impact.earliestStartAt
      });
    }

    const updated = await this.adminRepository.deactivateMaster(input);
    if (!updated) {
      throw appError("TENANT_NOT_FOUND", { reason: "master_not_found_in_tenant" });
    }
    return updated;
  }

  async listServices(tenantId: string) {
    return this.adminRepository.listServices(tenantId);
  }

  async createService(input: {
    tenantId: string;
    displayName: string;
    durationMinutes: number;
    priceCents?: number;
    sortOrder?: number;
    isActive?: boolean;
    masterIds?: string[];
  }) {
    const displayName = input.displayName.trim();
    if (!displayName) {
      throw appError("VALIDATION_ERROR", { reason: "display_name_required" });
    }
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
      throw appError("VALIDATION_ERROR", { reason: "duration_minutes_invalid" });
    }
    if (input.priceCents !== undefined && (!Number.isInteger(input.priceCents) || input.priceCents < 0)) {
      throw appError("VALIDATION_ERROR", { reason: "price_cents_invalid" });
    }
    if (input.sortOrder !== undefined && !Number.isInteger(input.sortOrder)) {
      throw appError("VALIDATION_ERROR", { reason: "sort_order_invalid" });
    }
    const normalizedMasterIds = Array.from(
      new Set((input.masterIds ?? []).filter((value) => typeof value === "string" && value.trim().length > 0))
    );
    if ((input.isActive ?? true) && normalizedMasterIds.length === 0) {
      throw appError("VALIDATION_ERROR", { reason: "service_requires_active_master_mapping" });
    }
    if (normalizedMasterIds.length > 0) {
      const activeMasters = await this.adminRepository.listActiveMasters(input.tenantId);
      const activeMasterSet = new Set(activeMasters.map((master) => master.id));
      for (const masterId of normalizedMasterIds) {
        if (!activeMasterSet.has(masterId)) {
          throw appError("VALIDATION_ERROR", { reason: "master_not_active_or_not_in_tenant", masterId });
        }
      }
    }

    const created = await this.adminRepository.createService({
      ...input,
      masterIds: normalizedMasterIds
    });
    if (!created) {
      throw appError("INTERNAL_ERROR", { reason: "service_create_failed" });
    }

    return created;
  }

  async updateService(input: {
    tenantId: string;
    serviceId: string;
    displayName: string;
    durationMinutes: number;
    priceCents: number | null;
    sortOrder: number;
    isActive: boolean;
  }) {
    const displayName = input.displayName.trim();
    if (!displayName) {
      throw appError("VALIDATION_ERROR", { reason: "display_name_required" });
    }
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
      throw appError("VALIDATION_ERROR", { reason: "duration_minutes_invalid" });
    }
    if (input.priceCents !== null && (!Number.isInteger(input.priceCents) || input.priceCents < 0)) {
      throw appError("VALIDATION_ERROR", { reason: "price_cents_invalid" });
    }
    if (!Number.isInteger(input.sortOrder)) {
      throw appError("VALIDATION_ERROR", { reason: "sort_order_invalid" });
    }

    if (input.isActive) {
      const activeMappingCount = await this.adminRepository.countActiveMasterMappingsByService({
        tenantId: input.tenantId,
        serviceId: input.serviceId
      });
      if (activeMappingCount <= 0) {
        throw appError("VALIDATION_ERROR", { reason: "service_requires_active_master_mapping" });
      }
    }

    const updated = await this.adminRepository.updateService(input);
    if (!updated) {
      throw appError("TENANT_NOT_FOUND", { reason: "service_not_found_in_tenant" });
    }

    return updated;
  }

  async deleteService(input: { tenantId: string; serviceId: string }) {
    const updated = await this.adminRepository.deactivateService(input);
    if (!updated) {
      throw appError("TENANT_NOT_FOUND", { reason: "service_not_found_in_tenant" });
    }
    return updated;
  }

  private assertLocale(locale: string) {
    if (locale !== "it" && locale !== "en") {
      throw appError("VALIDATION_ERROR", { reason: "locale_invalid" });
    }
  }

  async listMasterTranslations(tenantId: string) {
    return this.adminRepository.listMasterTranslations(tenantId);
  }

  async upsertMasterTranslation(input: {
    tenantId: string;
    masterId: string;
    locale: string;
    displayName: string;
    bio?: string | null;
  }) {
    this.assertLocale(input.locale);
    if (!input.masterId || !input.displayName.trim()) {
      throw appError("VALIDATION_ERROR", { required: ["masterId", "displayName"] });
    }

    const item = await this.adminRepository.upsertMasterTranslation({
      ...input,
      displayName: input.displayName.trim()
    });
    if (!item) {
      throw appError("TENANT_NOT_FOUND", { reason: "master_not_found_in_tenant" });
    }
    return item;
  }

  async deleteMasterTranslation(input: { tenantId: string; masterId: string; locale: string }) {
    this.assertLocale(input.locale);
    const item = await this.adminRepository.deleteMasterTranslation(input);
    if (!item) {
      throw appError("TENANT_NOT_FOUND", { reason: "master_translation_not_found_in_tenant" });
    }
    return item;
  }

  async listServiceTranslations(tenantId: string) {
    return this.adminRepository.listServiceTranslations(tenantId);
  }

  async upsertServiceTranslation(input: {
    tenantId: string;
    serviceId: string;
    locale: string;
    displayName: string;
    description?: string | null;
  }) {
    this.assertLocale(input.locale);
    if (!input.serviceId || !input.displayName.trim()) {
      throw appError("VALIDATION_ERROR", { required: ["serviceId", "displayName"] });
    }

    const item = await this.adminRepository.upsertServiceTranslation({
      ...input,
      displayName: input.displayName.trim()
    });
    if (!item) {
      throw appError("TENANT_NOT_FOUND", { reason: "service_not_found_in_tenant" });
    }
    return item;
  }

  async deleteServiceTranslation(input: { tenantId: string; serviceId: string; locale: string }) {
    this.assertLocale(input.locale);
    const item = await this.adminRepository.deleteServiceTranslation(input);
    if (!item) {
      throw appError("TENANT_NOT_FOUND", { reason: "service_translation_not_found_in_tenant" });
    }
    return item;
  }

  async listMasterServices(tenantId: string) {
    return this.adminRepository.listMasterServices(tenantId);
  }

  async getServiceMasterMappings(input: { tenantId: string; serviceId: string }) {
    const service = await this.adminRepository.findServiceById({
      tenantId: input.tenantId,
      serviceId: input.serviceId
    });
    if (!service) {
      throw appError("TENANT_NOT_FOUND", { reason: "service_not_found_in_tenant" });
    }

    const [masterIds, masters] = await Promise.all([
      this.adminRepository.listServiceMasterIds(input),
      this.adminRepository.listActiveMasters(input.tenantId)
    ]);

    return {
      serviceId: input.serviceId,
      masterIds,
      masters
    };
  }

  async replaceServiceMasterMappings(input: {
    tenantId: string;
    serviceId: string;
    masterIds: string[];
    actorUserId?: string;
    requestId?: string;
  }) {
    const service = await this.adminRepository.findServiceById({
      tenantId: input.tenantId,
      serviceId: input.serviceId
    });
    if (!service) {
      throw appError("TENANT_NOT_FOUND", { reason: "service_not_found_in_tenant" });
    }

    const normalizedMasterIds = Array.from(new Set(input.masterIds.filter((value) => typeof value === "string" && value.trim().length > 0)));
    const activeMasters = await this.adminRepository.listActiveMasters(input.tenantId);
    const activeMasterSet = new Set(activeMasters.map((master) => master.id));
    for (const masterId of normalizedMasterIds) {
      if (!activeMasterSet.has(masterId)) {
        throw appError("VALIDATION_ERROR", { reason: "master_not_active_or_not_in_tenant", masterId });
      }
    }

    if (service.isActive && normalizedMasterIds.length === 0) {
      throw appError("VALIDATION_ERROR", { reason: "service_requires_active_master_mapping" });
    }

    const before = await this.adminRepository.listServiceMasterIds({
      tenantId: input.tenantId,
      serviceId: input.serviceId
    });
    await this.adminRepository.replaceServiceMasterMappings({
      tenantId: input.tenantId,
      serviceId: input.serviceId,
      masterIds: normalizedMasterIds
    });

    await this.auditRepository.create({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "service_master_mapping_updated",
      entity: "service",
      entityId: input.serviceId,
      meta: {
        requestId: input.requestId,
        mastersCountBefore: before.length,
        mastersCountAfter: normalizedMasterIds.length
      }
    });

    return {
      serviceId: input.serviceId,
      masterIds: normalizedMasterIds
    };
  }

  async createMasterService(input: {
    tenantId: string;
    masterId: string;
    serviceId: string;
    durationMinutesOverride?: number;
  }) {
    if (!input.masterId || !input.serviceId) {
      throw appError("VALIDATION_ERROR", { required: ["masterId", "serviceId"] });
    }
    if (
      input.durationMinutesOverride !== undefined &&
      (!Number.isInteger(input.durationMinutesOverride) || input.durationMinutesOverride <= 0)
    ) {
      throw appError("VALIDATION_ERROR", { reason: "duration_minutes_override_invalid" });
    }

    const created = await this.adminRepository.createMasterService(input);
    if (!created) {
      throw appError("INTERNAL_ERROR", { reason: "master_service_create_failed" });
    }
    return created;
  }

  async updateMasterService(input: {
    tenantId: string;
    id: string;
    masterId: string;
    serviceId: string;
    durationMinutesOverride: number | null;
  }) {
    if (!input.masterId || !input.serviceId) {
      throw appError("VALIDATION_ERROR", { required: ["masterId", "serviceId"] });
    }
    if (
      input.durationMinutesOverride !== null &&
      (!Number.isInteger(input.durationMinutesOverride) || input.durationMinutesOverride <= 0)
    ) {
      throw appError("VALIDATION_ERROR", { reason: "duration_minutes_override_invalid" });
    }

    const updated = await this.adminRepository.updateMasterService(input);
    if (!updated) {
      throw appError("TENANT_NOT_FOUND", { reason: "master_service_not_found_in_tenant" });
    }
    return updated;
  }

  async deleteMasterService(input: { tenantId: string; id: string }) {
    const deleted = await this.adminRepository.deleteMasterService(input);
    if (!deleted) {
      throw appError("TENANT_NOT_FOUND", { reason: "master_service_not_found_in_tenant" });
    }
    return deleted;
  }

  async listWorkingHours(tenantId: string) {
    return this.adminRepository.listWorkingHours(tenantId);
  }

  async createWorkingHours(input: {
    tenantId: string;
    masterId?: string;
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
    isActive?: boolean;
  }) {
    if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) {
      throw appError("VALIDATION_ERROR", { reason: "day_of_week_invalid" });
    }
    this.assertMinuteRange(input.startMinute, input.endMinute);

    const created = await this.adminRepository.createWorkingHours(input);
    if (!created) {
      throw appError("INTERNAL_ERROR", { reason: "working_hours_create_failed" });
    }
    return created;
  }

  async updateWorkingHours(input: {
    tenantId: string;
    id: string;
    masterId: string | null;
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
    isActive: boolean;
  }) {
    if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) {
      throw appError("VALIDATION_ERROR", { reason: "day_of_week_invalid" });
    }
    this.assertMinuteRange(input.startMinute, input.endMinute);

    const updated = await this.adminRepository.updateWorkingHours(input);
    if (!updated) {
      throw appError("TENANT_NOT_FOUND", { reason: "working_hours_not_found_in_tenant" });
    }
    return updated;
  }

  async deleteWorkingHours(input: { tenantId: string; id: string }) {
    const deleted = await this.adminRepository.deleteWorkingHours(input);
    if (!deleted) {
      throw appError("TENANT_NOT_FOUND", { reason: "working_hours_not_found_in_tenant" });
    }
    return deleted;
  }

  async listScheduleExceptions(tenantId: string) {
    return this.adminRepository.listScheduleExceptions(tenantId);
  }

  async createScheduleException(input: {
    tenantId: string;
    masterId?: string;
    date: string;
    isClosed?: boolean;
    startMinute?: number;
    endMinute?: number;
    note?: string;
  }) {
    if (!input.date) {
      throw appError("VALIDATION_ERROR", { required: ["date"] });
    }
    if (input.startMinute !== undefined || input.endMinute !== undefined) {
      if (input.startMinute === undefined || input.endMinute === undefined) {
        throw appError("VALIDATION_ERROR", { reason: "minute_range_invalid" });
      }
      this.assertMinuteRange(input.startMinute, input.endMinute);
    }

    const created = await this.adminRepository.createScheduleException(input);
    if (!created) {
      throw appError("INTERNAL_ERROR", { reason: "schedule_exception_create_failed" });
    }
    return created;
  }

  async updateScheduleException(input: {
    tenantId: string;
    id: string;
    masterId: string | null;
    date: string;
    isClosed: boolean;
    startMinute: number | null;
    endMinute: number | null;
    note: string | null;
  }) {
    if (!input.date) {
      throw appError("VALIDATION_ERROR", { required: ["date"] });
    }
    if (input.startMinute !== null || input.endMinute !== null) {
      if (input.startMinute === null || input.endMinute === null) {
        throw appError("VALIDATION_ERROR", { reason: "minute_range_invalid" });
      }
      this.assertMinuteRange(input.startMinute, input.endMinute);
    }

    const updated = await this.adminRepository.updateScheduleException(input);
    if (!updated) {
      throw appError("TENANT_NOT_FOUND", { reason: "schedule_exception_not_found_in_tenant" });
    }
    return updated;
  }

  async deleteScheduleException(input: { tenantId: string; id: string }) {
    const deleted = await this.adminRepository.deleteScheduleException(input);
    if (!deleted) {
      throw appError("TENANT_NOT_FOUND", { reason: "schedule_exception_not_found_in_tenant" });
    }
    return deleted;
  }

  async updateTenantSettings(input: {
    tenantId: string;
    actorUserId?: string;
    defaultLocale?: "it" | "en";
    timezone?: string;
    bookingHorizonDays?: number;
    bookingMinAdvanceMinutes?: number;
    bookingBufferMinutes?: number;
    adminNotificationEmail?: string | null;
    adminNotificationTelegramChatId?: number | null;
    adminNotificationWhatsappE164?: string | null;
    openaiEnabled?: boolean;
    openaiModel?: string;
    humanHandoffEnabled?: boolean;
    requestId?: string;
  }) {
    if (input.timezone !== undefined) {
      this.assertValidTimezone(input.timezone, "timezone_invalid");
    }
    if (input.defaultLocale && input.defaultLocale !== "it" && input.defaultLocale !== "en") {
      throw appError("VALIDATION_ERROR", { reason: "default_locale_invalid" });
    }
    if (input.bookingHorizonDays !== undefined) {
      if (!Number.isInteger(input.bookingHorizonDays) || input.bookingHorizonDays <= 0) {
        throw appError("VALIDATION_ERROR", { reason: "booking_horizon_days_invalid" });
      }
    }
    if (input.bookingMinAdvanceMinutes !== undefined) {
      if (
        !Number.isInteger(input.bookingMinAdvanceMinutes) ||
        input.bookingMinAdvanceMinutes < 0
      ) {
        throw appError("VALIDATION_ERROR", { reason: "booking_min_advance_minutes_invalid" });
      }
    }
    if (input.bookingBufferMinutes !== undefined) {
      if (!Number.isInteger(input.bookingBufferMinutes) || input.bookingBufferMinutes < 0) {
        throw appError("VALIDATION_ERROR", { reason: "booking_buffer_minutes_invalid" });
      }
    }
    if (input.openaiModel !== undefined) {
      const normalized = input.openaiModel.trim();
      if (!normalized) {
        throw appError("VALIDATION_ERROR", { reason: "openai_model_invalid" });
      }
      input.openaiModel = normalized;
    }
    if (input.adminNotificationWhatsappE164 !== undefined) {
      const value = input.adminNotificationWhatsappE164;
      if (value !== null && value.trim() && !/^\+[1-9]\d{5,14}$/.test(value.trim())) {
        throw appError("VALIDATION_ERROR", { reason: "admin_notification_whatsapp_e164_invalid" });
      }
      input.adminNotificationWhatsappE164 = value?.trim() ? value.trim() : null;
    }

    const updated = await this.tenantRepository.updateSettings(input);
    if (!updated) {
      throw appError("TENANT_NOT_FOUND");
    }

    await this.auditRepository.create({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tenant_settings_updated",
      entity: "tenant",
      entityId: input.tenantId,
      meta: {
        requestId: input.requestId,
        changed: {
          defaultLocale: input.defaultLocale,
          timezone: input.timezone,
          bookingHorizonDays: input.bookingHorizonDays,
          bookingMinAdvanceMinutes: input.bookingMinAdvanceMinutes,
          bookingBufferMinutes: input.bookingBufferMinutes,
          adminNotificationEmail: input.adminNotificationEmail,
          adminNotificationTelegramChatId: input.adminNotificationTelegramChatId,
          adminNotificationWhatsappE164: input.adminNotificationWhatsappE164,
          openaiEnabled: input.openaiEnabled,
          openaiModel: input.openaiModel,
          humanHandoffEnabled: input.humanHandoffEnabled
        }
      }
    });

    return updated;
  }

  async getTenantSettings(tenantId: string) {
    const tenant = await this.tenantRepository.findById(tenantId);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND");
    }

    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      defaultLocale: tenant.defaultLocale,
      timezone: tenant.timezone,
      bookingHorizonDays: tenant.bookingHorizonDays,
      bookingMinAdvanceMinutes: tenant.bookingMinAdvanceMinutes,
      bookingBufferMinutes: tenant.bookingBufferMinutes,
      adminNotificationEmail: tenant.adminNotificationEmail,
      adminNotificationTelegramChatId: tenant.adminNotificationTelegramChatId,
      adminNotificationWhatsappE164: tenant.adminNotificationWhatsappE164,
      desiredWhatsappBotE164: tenant.desiredWhatsappBotE164,
      operatorWhatsappE164: tenant.operatorWhatsappE164,
      openaiEnabled: tenant.openaiEnabled,
      openaiModel: tenant.openaiModel,
      humanHandoffEnabled: tenant.humanHandoffEnabled
    };
  }

  async getOperationalSettings(tenantId: string) {
    const tenant = await this.tenantRepository.findById(tenantId);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND");
    }

    const [endpoints, botNumberConflict] = await Promise.all([
      this.channelEndpointRepository.listWhatsAppEndpointsByTenantIds([tenantId]),
      tenant.desiredWhatsappBotE164
        ? this.channelEndpointRepository.findActiveWhatsAppEndpointConflictByE164({
            tenantId,
            e164: tenant.desiredWhatsappBotE164
          })
        : Promise.resolve(null)
    ]);

    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      timezone: tenant.timezone,
      address: {
        country: tenant.addressCountry ?? "",
        city: tenant.addressCity ?? "",
        line1: tenant.addressLine1 ?? "",
        line2: tenant.addressLine2 ?? "",
        postalCode: tenant.addressPostalCode ?? ""
      },
      parking: {
        available: tenant.parkingAvailable ?? null,
        note: tenant.parkingNote ?? ""
      },
      businessHoursNote: tenant.businessHoursNote ?? "",
      whatsapp: computeWhatsAppSetupSummary({
        desiredBotNumber: tenant.desiredWhatsappBotE164,
        operatorNumber: tenant.operatorWhatsappE164,
        endpoints,
        hasBotNumberConflict: Boolean(botNumberConflict)
      })
    };
  }

  async updateOperationalSettings(input: {
    tenantId: string;
    actorUserId?: string;
    requestId?: string;
    timezone?: string;
    address?: {
      country?: string | null;
      city?: string | null;
      line1?: string | null;
      line2?: string | null;
      postalCode?: string | null;
    };
    parking?: {
      available?: boolean | null;
      note?: string | null;
    };
    businessHoursNote?: string | null;
    whatsapp?: {
      desiredBotNumber?: string | null;
      operatorNumber?: string | null;
    };
  }) {
    if (input.timezone !== undefined) {
      this.assertValidTimezone(input.timezone, "timezone_invalid");
    }
    const tenant = await this.tenantRepository.findById(input.tenantId);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND");
    }

    const desiredWhatsappBotE164 = this.validateOptionalE164(
      input.whatsapp?.desiredBotNumber,
      "desired_whatsapp_bot_e164_invalid"
    );
    const operatorWhatsappE164 = this.validateOptionalE164(
      input.whatsapp?.operatorNumber,
      "operator_whatsapp_e164_invalid"
    );
    const effectiveDesiredWhatsappBotE164 =
      desiredWhatsappBotE164 !== undefined ? desiredWhatsappBotE164 : tenant.desiredWhatsappBotE164;
    const effectiveOperatorWhatsappE164 =
      operatorWhatsappE164 !== undefined ? operatorWhatsappE164 : tenant.operatorWhatsappE164;

    if (
      effectiveDesiredWhatsappBotE164 &&
      effectiveOperatorWhatsappE164 &&
      effectiveDesiredWhatsappBotE164 === effectiveOperatorWhatsappE164
    ) {
      throw appError("VALIDATION_ERROR", { reason: "whatsapp_numbers_must_be_different" });
    }
    if (effectiveDesiredWhatsappBotE164) {
      const conflict = await this.channelEndpointRepository.findActiveWhatsAppEndpointConflictByE164({
        tenantId: input.tenantId,
        e164: effectiveDesiredWhatsappBotE164
      });
      if (conflict) {
        throw appError("CONFLICT", {
          reason: "desired_whatsapp_bot_e164_conflict",
          conflictTenantId: conflict.tenantId,
          conflictTenantSlug: conflict.tenantSlug
        });
      }
    }

    const endpoints = await this.channelEndpointRepository.listWhatsAppEndpointsByTenantIds([input.tenantId]);
    const connectedActiveEndpoints = endpoints.filter(
      (item) => item.isActive && item.bindingStatus === "connected" && item.e164
    );
    if (connectedActiveEndpoints.length > 0) {
      if (!effectiveDesiredWhatsappBotE164) {
        throw appError("VALIDATION_ERROR", {
          reason: "whatsapp_desired_bot_required_for_connected_endpoint"
        });
      }
      if (!effectiveOperatorWhatsappE164) {
        throw appError("VALIDATION_ERROR", {
          reason: "whatsapp_operator_required_for_connected_endpoint"
        });
      }
      const isDesiredNumberConnectedToTenant = connectedActiveEndpoints.some(
        (item) => item.e164 === effectiveDesiredWhatsappBotE164
      );
      if (!isDesiredNumberConnectedToTenant) {
        throw appError("VALIDATION_ERROR", {
          reason: "whatsapp_routing_mismatch_for_tenant"
        });
      }
    }

    const patch = {
      tenantId: input.tenantId,
      timezone: input.timezone,
      addressCountry: this.normalizeOptionalText(input.address?.country),
      addressCity: this.normalizeOptionalText(input.address?.city),
      addressLine1: this.normalizeOptionalText(input.address?.line1),
      addressLine2: this.normalizeOptionalText(input.address?.line2),
      addressPostalCode: this.normalizeOptionalText(input.address?.postalCode),
      parkingAvailable: input.parking?.available,
      parkingNote: this.normalizeOptionalText(input.parking?.note),
      businessHoursNote: this.normalizeOptionalText(input.businessHoursNote),
      desiredWhatsappBotE164,
      operatorWhatsappE164,
      // Keep one source of truth for admin confirmations and handoff contact.
      adminNotificationWhatsappE164:
        operatorWhatsappE164 !== undefined ? operatorWhatsappE164 : undefined
    };

    const updated = await this.tenantRepository.updateSettings(patch);
    if (!updated) {
      throw appError("TENANT_NOT_FOUND");
    }

    await this.auditRepository.create({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tenant_operational_settings_updated",
      entity: "tenant",
      entityId: input.tenantId,
      meta: {
        requestId: input.requestId,
        changed: {
          timezone: patch.timezone,
          addressCountry: patch.addressCountry,
          addressCity: patch.addressCity,
          addressLine1: patch.addressLine1,
          addressLine2: patch.addressLine2,
          addressPostalCode: patch.addressPostalCode,
          parkingAvailable: patch.parkingAvailable,
          parkingNote: patch.parkingNote,
          businessHoursNote: patch.businessHoursNote,
          desiredWhatsappBotE164: patch.desiredWhatsappBotE164,
          operatorWhatsappE164: patch.operatorWhatsappE164,
          adminNotificationWhatsappE164: patch.adminNotificationWhatsappE164
        }
      }
    });

    return this.getOperationalSettings(input.tenantId);
  }

  async getScope(tenantId: string) {
    const tenant = await this.tenantRepository.findById(tenantId);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND");
    }

    const limits = await this.subscriptionGovernanceService.getActiveLimits(tenantId).catch(async (error) => {
      await captureException({
        service: "api",
        error,
        context: {
          tenantId,
          source: "admin_scope_limits_fallback"
        }
      });
      return {
        planCode: null,
        maxSalons: null,
        maxStaff: null,
        maxBookingsPerMonth: null
      };
    });

    return {
      account: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name
      },
      salons: [
        {
          id: "default",
          accountId: tenant.id,
          name: tenant.name,
          isPrimary: true
        }
      ],
      capabilities: {
        multiSalon: (limits.maxSalons ?? 1) > 1
      },
      subscription: {
        planCode: limits.planCode,
        limits: {
          maxSalons: limits.maxSalons,
          maxStaff: limits.maxStaff,
          maxBookingsPerMonth: limits.maxBookingsPerMonth
        }
      }
    };
  }
}
