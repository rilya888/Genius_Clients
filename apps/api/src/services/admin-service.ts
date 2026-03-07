import { appError } from "../lib/http";
import {
  AuditRepository,
  AdminRepository,
  NotificationRepository,
  StripeRepository,
  TenantRepository
} from "../repositories";

export class AdminService {
  private readonly adminRepository = new AdminRepository();
  private readonly tenantRepository = new TenantRepository();
  private readonly auditRepository = new AuditRepository();
  private readonly notificationRepository = new NotificationRepository();
  private readonly stripeRepository = new StripeRepository();

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
  }) {
    const displayName = input.displayName.trim();
    if (!displayName) {
      throw appError("VALIDATION_ERROR", { reason: "display_name_required" });
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

  async deleteMaster(input: { tenantId: string; masterId: string }) {
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

    const created = await this.adminRepository.createService(input);
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
    requestId?: string;
  }) {
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
          adminNotificationTelegramChatId: input.adminNotificationTelegramChatId
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
      adminNotificationTelegramChatId: tenant.adminNotificationTelegramChatId
    };
  }
}
