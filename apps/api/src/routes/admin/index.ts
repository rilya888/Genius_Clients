import { Hono } from "hono";
import type { ApiAppEnv } from "../../lib/hono-env";
import { appError } from "../../lib/http";
import { AdminService, BookingService } from "../../services";

const adminService = new AdminService();
const bookingService = new BookingService();

export const adminRoutes = new Hono<ApiAppEnv>()
  .get("/stripe-customers", async (c) => {
    const actorRole = c.get("userRole");
    if (actorRole !== "owner") {
      throw appError("AUTH_FORBIDDEN", { reason: "owner_role_required" });
    }

    const tenantId = c.get("tenantId");
    const limit = c.req.query("limit");
    const items = await adminService.listStripeCustomers({
      tenantId,
      limit: limit ? Number(limit) : undefined
    });
    return c.json({ data: { items } });
  })
  .get("/integrations/status", async (c) => {
    const actorRole = c.get("userRole");
    if (actorRole !== "owner") {
      throw appError("AUTH_FORBIDDEN", { reason: "owner_role_required" });
    }

    return c.json({
      data: {
        redis: Boolean(process.env.REDIS_URL),
        sentry: Boolean(process.env.SENTRY_DSN),
        stripe: Boolean(process.env.STRIPE_SECRET_KEY),
        openai: Boolean(process.env.OPENAI_API_KEY),
        whatsapp:
          Boolean(process.env.WA_PHONE_NUMBER_ID) &&
          Boolean(process.env.WA_ACCESS_TOKEN) &&
          Boolean(process.env.WA_WEBHOOK_SECRET),
        telegram: Boolean(process.env.TG_BOT_TOKEN),
        email: Boolean(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM)
      }
    });
  })
  .get("/notification-deliveries/summary", async (c) => {
    const tenantId = c.get("tenantId");
    const data = await adminService.getNotificationDeliverySummary(tenantId);
    return c.json({ data });
  })
  .get("/scope", async (c) => {
    const tenantId = c.get("tenantId");
    return c.json({ data: await adminService.getScope(tenantId) });
  })
  .post("/notification-deliveries/retry-failed", async (c) => {
    const tenantId = c.get("tenantId");
    const actorRole = c.get("userRole");
    const actorUserId = c.get("userId");
    const requestId = c.get("requestId");
    if (actorRole !== "owner") {
      throw appError("AUTH_FORBIDDEN", { reason: "owner_role_required" });
    }

    const body = await c.req
      .json<{ limit?: number }>()
      .catch((): { limit?: number } => ({}));
    const data = await adminService.retryFailedNotificationDeliveries({
      tenantId,
      limit: body.limit,
      actorUserId,
      requestId
    });

    return c.json({ data });
  })
  .get("/notification-deliveries", async (c) => {
    const tenantId = c.get("tenantId");
    const limit = c.req.query("limit");
    const items = await adminService.listNotificationDeliveries({
      tenantId,
      limit: limit ? Number(limit) : undefined
    });
    return c.json({ data: { items } });
  })
  .get("/masters", async (c) => {
    const tenantId = c.get("tenantId");
    return c.json({ data: { items: await adminService.listMasters(tenantId) } });
  })
  .post("/masters", async (c) => {
    const tenantId = c.get("tenantId");
    const body = await c.req.json<{ displayName?: string; isActive?: boolean }>();
    if (!body.displayName) {
      throw appError("VALIDATION_ERROR", { required: ["displayName"] });
    }

    const item = await adminService.createMaster({
      tenantId,
      displayName: body.displayName,
      isActive: body.isActive
    });

    return c.json({ data: item }, 201);
  })
  .put("/masters/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const masterId = c.req.param("id");
    const body = await c.req.json<{ displayName?: string; isActive?: boolean }>();
    if (!body.displayName) {
      throw appError("VALIDATION_ERROR", { required: ["displayName"] });
    }

    const item = await adminService.updateMaster({
      tenantId,
      masterId,
      displayName: body.displayName,
      isActive: body.isActive ?? true
    });

    return c.json({ data: item });
  })
  .delete("/masters/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const masterId = c.req.param("id");
    const item = await adminService.deleteMaster({ tenantId, masterId });
    return c.json({ data: item });
  })
  .get("/services", async (c) => {
    const tenantId = c.get("tenantId");
    return c.json({ data: { items: await adminService.listServices(tenantId) } });
  })
  .post("/services", async (c) => {
    const tenantId = c.get("tenantId");
    const body = await c.req.json<{
      displayName?: string;
      durationMinutes?: number;
      priceCents?: number;
      sortOrder?: number;
      isActive?: boolean;
    }>();
    const durationMinutes = Number(body.durationMinutes);
    if (!body.displayName || !Number.isInteger(durationMinutes)) {
      throw appError("VALIDATION_ERROR", { required: ["displayName", "durationMinutes"] });
    }

    const item = await adminService.createService({
      tenantId,
      displayName: body.displayName,
      durationMinutes,
      priceCents: body.priceCents,
      sortOrder: body.sortOrder,
      isActive: body.isActive
    });

    return c.json({ data: item }, 201);
  })
  .put("/services/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const serviceId = c.req.param("id");
    const body = await c.req.json<{
      displayName?: string;
      durationMinutes?: number;
      priceCents?: number | null;
      sortOrder?: number;
      isActive?: boolean;
    }>();

    const durationMinutes = Number(body.durationMinutes);
    const sortOrder = Number(body.sortOrder);
    if (!body.displayName || !Number.isInteger(durationMinutes) || !Number.isInteger(sortOrder)) {
      throw appError("VALIDATION_ERROR", { required: ["displayName", "durationMinutes", "sortOrder"] });
    }

    const item = await adminService.updateService({
      tenantId,
      serviceId,
      displayName: body.displayName,
      durationMinutes,
      priceCents: body.priceCents ?? null,
      sortOrder,
      isActive: body.isActive ?? true
    });

    return c.json({ data: item });
  })
  .delete("/services/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const serviceId = c.req.param("id");
    const item = await adminService.deleteService({ tenantId, serviceId });
    return c.json({ data: item });
  })
  .get("/master-translations", async (c) => {
    const tenantId = c.get("tenantId");
    return c.json({ data: { items: await adminService.listMasterTranslations(tenantId) } });
  })
  .post("/master-translations", async (c) => {
    const tenantId = c.get("tenantId");
    const body = await c.req.json<{
      masterId?: string;
      locale?: string;
      displayName?: string;
      bio?: string | null;
    }>();
    if (!body.masterId || !body.locale || !body.displayName) {
      throw appError("VALIDATION_ERROR", { required: ["masterId", "locale", "displayName"] });
    }

    const item = await adminService.upsertMasterTranslation({
      tenantId,
      masterId: body.masterId,
      locale: body.locale,
      displayName: body.displayName,
      bio: body.bio
    });

    return c.json({ data: item }, 201);
  })
  .put("/master-translations/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const masterId = c.req.param("id");
    const body = await c.req.json<{ locale?: string; displayName?: string; bio?: string | null }>();
    if (!body.locale || !body.displayName) {
      throw appError("VALIDATION_ERROR", { required: ["locale", "displayName"] });
    }

    const item = await adminService.upsertMasterTranslation({
      tenantId,
      masterId,
      locale: body.locale,
      displayName: body.displayName,
      bio: body.bio
    });

    return c.json({ data: item });
  })
  .delete("/master-translations/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const masterId = c.req.param("id");
    const locale = c.req.query("locale");
    if (!locale) {
      throw appError("VALIDATION_ERROR", { required: ["locale"] });
    }

    const item = await adminService.deleteMasterTranslation({ tenantId, masterId, locale });
    return c.json({ data: item });
  })
  .get("/service-translations", async (c) => {
    const tenantId = c.get("tenantId");
    return c.json({ data: { items: await adminService.listServiceTranslations(tenantId) } });
  })
  .post("/service-translations", async (c) => {
    const tenantId = c.get("tenantId");
    const body = await c.req.json<{
      serviceId?: string;
      locale?: string;
      displayName?: string;
      description?: string | null;
    }>();
    if (!body.serviceId || !body.locale || !body.displayName) {
      throw appError("VALIDATION_ERROR", { required: ["serviceId", "locale", "displayName"] });
    }

    const item = await adminService.upsertServiceTranslation({
      tenantId,
      serviceId: body.serviceId,
      locale: body.locale,
      displayName: body.displayName,
      description: body.description
    });

    return c.json({ data: item }, 201);
  })
  .put("/service-translations/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const serviceId = c.req.param("id");
    const body = await c.req.json<{
      locale?: string;
      displayName?: string;
      description?: string | null;
    }>();
    if (!body.locale || !body.displayName) {
      throw appError("VALIDATION_ERROR", { required: ["locale", "displayName"] });
    }

    const item = await adminService.upsertServiceTranslation({
      tenantId,
      serviceId,
      locale: body.locale,
      displayName: body.displayName,
      description: body.description
    });

    return c.json({ data: item });
  })
  .delete("/service-translations/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const serviceId = c.req.param("id");
    const locale = c.req.query("locale");
    if (!locale) {
      throw appError("VALIDATION_ERROR", { required: ["locale"] });
    }

    const item = await adminService.deleteServiceTranslation({ tenantId, serviceId, locale });
    return c.json({ data: item });
  })
  .get("/master-services", async (c) => {
    const tenantId = c.get("tenantId");
    return c.json({ data: { items: await adminService.listMasterServices(tenantId) } });
  })
  .post("/master-services", async (c) => {
    const tenantId = c.get("tenantId");
    const body = await c.req.json<{
      masterId?: string;
      serviceId?: string;
      durationMinutesOverride?: number;
    }>();
    if (!body.masterId || !body.serviceId) {
      throw appError("VALIDATION_ERROR", { required: ["masterId", "serviceId"] });
    }

    const item = await adminService.createMasterService({
      tenantId,
      masterId: body.masterId,
      serviceId: body.serviceId,
      durationMinutesOverride: body.durationMinutesOverride
    });

    return c.json({ data: item }, 201);
  })
  .put("/master-services/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const id = c.req.param("id");
    const body = await c.req.json<{
      masterId?: string;
      serviceId?: string;
      durationMinutesOverride?: number | null;
    }>();
    if (!body.masterId || !body.serviceId) {
      throw appError("VALIDATION_ERROR", { required: ["masterId", "serviceId"] });
    }

    const item = await adminService.updateMasterService({
      tenantId,
      id,
      masterId: body.masterId,
      serviceId: body.serviceId,
      durationMinutesOverride: body.durationMinutesOverride ?? null
    });

    return c.json({ data: item });
  })
  .delete("/master-services/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const id = c.req.param("id");
    const item = await adminService.deleteMasterService({ tenantId, id });
    return c.json({ data: item });
  })
  .get("/working-hours", async (c) => {
    const tenantId = c.get("tenantId");
    return c.json({ data: { items: await adminService.listWorkingHours(tenantId) } });
  })
  .post("/working-hours", async (c) => {
    const tenantId = c.get("tenantId");
    const body = await c.req.json<{
      masterId?: string;
      dayOfWeek?: number;
      startMinute?: number;
      endMinute?: number;
      isActive?: boolean;
    }>();
    const dayOfWeek = Number(body.dayOfWeek);
    const startMinute = Number(body.startMinute);
    const endMinute = Number(body.endMinute);
    if (!Number.isInteger(dayOfWeek) || !Number.isInteger(startMinute) || !Number.isInteger(endMinute)) {
      throw appError("VALIDATION_ERROR", { required: ["dayOfWeek", "startMinute", "endMinute"] });
    }

    const item = await adminService.createWorkingHours({
      tenantId,
      masterId: body.masterId,
      dayOfWeek,
      startMinute,
      endMinute,
      isActive: body.isActive
    });

    return c.json({ data: item }, 201);
  })
  .put("/working-hours/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const id = c.req.param("id");
    const body = await c.req.json<{
      masterId?: string | null;
      dayOfWeek?: number;
      startMinute?: number;
      endMinute?: number;
      isActive?: boolean;
    }>();
    const dayOfWeek = Number(body.dayOfWeek);
    const startMinute = Number(body.startMinute);
    const endMinute = Number(body.endMinute);
    if (!Number.isInteger(dayOfWeek) || !Number.isInteger(startMinute) || !Number.isInteger(endMinute)) {
      throw appError("VALIDATION_ERROR", { required: ["dayOfWeek", "startMinute", "endMinute"] });
    }

    const item = await adminService.updateWorkingHours({
      tenantId,
      id,
      masterId: body.masterId ?? null,
      dayOfWeek,
      startMinute,
      endMinute,
      isActive: body.isActive ?? true
    });

    return c.json({ data: item });
  })
  .delete("/working-hours/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const id = c.req.param("id");
    const item = await adminService.deleteWorkingHours({ tenantId, id });
    return c.json({ data: item });
  })
  .get("/exceptions", async (c) => {
    const tenantId = c.get("tenantId");
    return c.json({ data: { items: await adminService.listScheduleExceptions(tenantId) } });
  })
  .post("/exceptions", async (c) => {
    const tenantId = c.get("tenantId");
    const body = await c.req.json<{
      masterId?: string;
      date?: string;
      isClosed?: boolean;
      startMinute?: number;
      endMinute?: number;
      note?: string;
    }>();
    if (!body.date) {
      throw appError("VALIDATION_ERROR", { required: ["date"] });
    }

    const item = await adminService.createScheduleException({
      tenantId,
      masterId: body.masterId,
      date: body.date,
      isClosed: body.isClosed,
      startMinute: body.startMinute,
      endMinute: body.endMinute,
      note: body.note
    });

    return c.json({ data: item }, 201);
  })
  .put("/exceptions/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const id = c.req.param("id");
    const body = await c.req.json<{
      masterId?: string | null;
      date?: string;
      isClosed?: boolean;
      startMinute?: number | null;
      endMinute?: number | null;
      note?: string | null;
    }>();
    if (!body.date) {
      throw appError("VALIDATION_ERROR", { required: ["date"] });
    }

    const item = await adminService.updateScheduleException({
      tenantId,
      id,
      masterId: body.masterId ?? null,
      date: body.date,
      isClosed: body.isClosed ?? false,
      startMinute: body.startMinute ?? null,
      endMinute: body.endMinute ?? null,
      note: body.note ?? null
    });

    return c.json({ data: item });
  })
  .delete("/exceptions/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const id = c.req.param("id");
    const item = await adminService.deleteScheduleException({ tenantId, id });
    return c.json({ data: item });
  })
  .get("/bookings", async (c) => {
    const tenantId = c.get("tenantId");
    const statusRaw = c.req.query("status");
    const from = c.req.query("from");
    const to = c.req.query("to");
    const limit = c.req.query("limit");
    const offset = c.req.query("offset");
    const allowedStatuses = new Set(["pending", "confirmed", "completed", "cancelled"]);

    if (statusRaw && !allowedStatuses.has(statusRaw)) {
      throw appError("VALIDATION_ERROR", { reason: "booking_status_invalid" });
    }

    const items = await bookingService.listAdminBookings({
      tenantId,
      status: statusRaw as "pending" | "confirmed" | "completed" | "cancelled" | undefined,
      fromIso: from,
      toIso: to,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined
    });

    return c.json({ data: { items } });
  })
  .patch("/bookings/:id", async (c) => {
    const tenantId = c.get("tenantId");
    const actorUserId = c.get("userId");
    const requestId = c.get("requestId");
    const bookingId = c.req.param("id");
    const body = await c.req.json<{
      status?: "pending" | "confirmed" | "completed" | "cancelled";
      cancellationReason?: string;
    }>();

    if (!body.status) {
      throw appError("VALIDATION_ERROR", { required: ["status"] });
    }

    const updated = await bookingService.updateAdminBookingStatus({
      tenantId,
      bookingId,
      nextStatus: body.status,
      cancellationReason: body.cancellationReason,
      requestId,
      actorUserId
    });

    return c.json({ data: updated });
  })
  .patch("/tenant-settings", async (c) => {
    const tenantId = c.get("tenantId");
    const actorUserId = c.get("userId");
    const actorRole = c.get("userRole");
    const requestId = c.get("requestId");
    if (actorRole !== "owner") {
      throw appError("AUTH_FORBIDDEN", { reason: "owner_role_required" });
    }
    const body = await c.req.json<{
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
    }>();

    const updated = await adminService.updateTenantSettings({
      tenantId,
      actorUserId,
      requestId,
      defaultLocale: body.defaultLocale,
      timezone: body.timezone,
      bookingHorizonDays: body.bookingHorizonDays,
      bookingMinAdvanceMinutes: body.bookingMinAdvanceMinutes,
      bookingBufferMinutes: body.bookingBufferMinutes,
      adminNotificationEmail: body.adminNotificationEmail,
      adminNotificationTelegramChatId: body.adminNotificationTelegramChatId,
      adminNotificationWhatsappE164: body.adminNotificationWhatsappE164,
      openaiEnabled: body.openaiEnabled,
      openaiModel: body.openaiModel,
      humanHandoffEnabled: body.humanHandoffEnabled
    });

    return c.json({ data: updated });
  })
  .get("/tenant-settings", async (c) => {
    const tenantId = c.get("tenantId");
    return c.json({ data: await adminService.getTenantSettings(tenantId) });
  });
