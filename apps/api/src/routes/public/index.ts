import { Hono } from "hono";
import { assertE164 } from "@genius/shared";
import type { ApiAppEnv } from "../../lib/hono-env";
import { appError } from "../../lib/http";
import { getApiEnv } from "../../lib/env";
import { BookingService, CatalogService, SlotService } from "../../services";
import { TenantRepository, WhatsAppWindowRepository } from "../../repositories";

const catalogService = new CatalogService();
const slotService = new SlotService();
const bookingService = new BookingService();
const tenantRepository = new TenantRepository();
const whatsappWindowRepository = new WhatsAppWindowRepository();

function getTimezoneOffsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(at);
  const timezoneName = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  const offsetMatch = /GMT([+-]\d{1,2})(?::?(\d{2}))?/.exec(timezoneName);
  if (!offsetMatch) {
    throw appError("INTERNAL_ERROR", { reason: "timezone_offset_parse_failed", timezone, timezoneName });
  }
  const hours = Number(offsetMatch[1]);
  const minutes = Number(offsetMatch[2] ?? "0");
  const sign = hours >= 0 ? 1 : -1;
  return sign * (Math.abs(hours) * 60 + minutes) * 60 * 1000;
}

function getUtcDateForTenantMidnight(
  dateParts: { year: number; month: number; day: number },
  timezone: string
): Date {
  const utcGuess = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 0, 0, 0, 0);
  const offsetMs = getTimezoneOffsetMs(new Date(utcGuess), timezone);
  return new Date(utcGuess - offsetMs);
}

function getTenantDateParts(at: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(at);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  if (!year || !month || !day) {
    throw appError("INTERNAL_ERROR", { reason: "tenant_date_parts_parse_failed", timezone });
  }
  return { year, month, day };
}

export const publicRoutes = new Hono<ApiAppEnv>()
  .get("/tenants/:slug", async (c) => {
    const slug = c.req.param("slug");
    const tenant = await tenantRepository.findBySlug(slug);

    if (!tenant) {
      throw appError("TENANT_NOT_FOUND");
    }

    return c.json({
      data: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        defaultLocale: tenant.defaultLocale,
        timezone: tenant.timezone,
        botConfig: {
          openaiEnabled: tenant.openaiEnabled,
          openaiModel: tenant.openaiModel,
          humanHandoffEnabled: tenant.humanHandoffEnabled,
          adminNotificationWhatsappE164: tenant.adminNotificationWhatsappE164
        }
      }
    });
  })
  .get("/masters", async (c) => {
    const tenantId = c.get("tenantId");
    const locale = c.req.query("locale") ?? undefined;
    const serviceId = c.req.query("serviceId") ?? undefined;
    return c.json({ data: { items: await catalogService.listMasters(tenantId, locale, serviceId) } });
  })
  .get("/services", async (c) => {
    const tenantId = c.get("tenantId");
    const locale = c.req.query("locale") ?? undefined;
    return c.json({ data: { items: await catalogService.listServices(tenantId, locale) } });
  })
  .get("/slots", async (c) => {
    const tenantId = c.get("tenantId");
    const serviceId = c.req.query("serviceId");
    const date = c.req.query("date");
    const masterId = c.req.query("masterId") ?? undefined;
    const includeDiagnostics = c.req.query("includeDiagnostics") === "1";

    if (!serviceId || !date) {
      throw appError("VALIDATION_ERROR", { required: ["serviceId", "date"] });
    }

    const result = await slotService.getAvailableSlots({
      tenantId,
      serviceId,
      date,
      masterId,
      includeDiagnostics
    });

    return c.json({
      data: {
        items: result.items,
        diagnostics: result.diagnostics
      }
    });
  })
  .post("/whatsapp/window-touch", async (c) => {
    const internalSecret = c.req.header("x-internal-secret");
    if (!internalSecret || internalSecret !== getApiEnv().internalApiSecret) {
      throw appError("AUTH_FORBIDDEN", { reason: "internal_secret_required" });
    }

    const body = await c.req.json<{
      senderPhoneNumberId?: string;
      recipientE164?: string;
      locale?: "it" | "en";
      inboundAtIso?: string;
    }>();
    if (!body.senderPhoneNumberId || !body.recipientE164) {
      throw appError("VALIDATION_ERROR", { required: ["senderPhoneNumberId", "recipientE164"] });
    }
    try {
      assertE164(body.recipientE164);
    } catch (error) {
      throw appError("VALIDATION_ERROR", {
        reason: "recipient_phone_invalid",
        details: error instanceof Error ? error.message : "invalid_phone"
      });
    }
    let inboundAt = new Date();
    if (body.inboundAtIso) {
      inboundAt = new Date(body.inboundAtIso);
      if (Number.isNaN(inboundAt.getTime())) {
        throw appError("VALIDATION_ERROR", { reason: "inboundAtIso_invalid" });
      }
    }

    const tenantId = c.get("tenantId");
    const data = await whatsappWindowRepository.touchInbound({
      tenantId,
      senderPhoneNumberId: body.senderPhoneNumberId.trim(),
      recipientE164: body.recipientE164.trim(),
      locale: body.locale,
      inboundAt
    });

    return c.json({ data: { id: data?.id ?? null } });
  })
  .post("/admin/bookings-digest", async (c) => {
    const internalSecret = c.req.header("x-internal-secret");
    if (!internalSecret || internalSecret !== getApiEnv().internalApiSecret) {
      throw appError("AUTH_FORBIDDEN", { reason: "internal_secret_required" });
    }

    const body = await c.req.json<{
      adminPhoneE164?: string;
      horizon?: "today" | "tomorrow" | "next";
      limit?: number;
    }>();
    if (!body.adminPhoneE164) {
      throw appError("VALIDATION_ERROR", { required: ["adminPhoneE164"] });
    }

    try {
      assertE164(body.adminPhoneE164);
    } catch (error) {
      throw appError("VALIDATION_ERROR", {
        reason: "admin_phone_invalid",
        details: error instanceof Error ? error.message : "invalid_phone"
      });
    }

    const tenantId = c.get("tenantId");
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND");
    }

    const allowedPhones = new Set(
      [tenant.adminNotificationWhatsappE164, tenant.operatorWhatsappE164]
        .filter(Boolean)
        .map((phone) => String(phone).trim())
    );
    if (!allowedPhones.has(body.adminPhoneE164.trim())) {
      throw appError("AUTH_FORBIDDEN", { reason: "admin_phone_not_authorized" });
    }

    const horizon = body.horizon ?? "today";
    const limitRaw = Number.isFinite(body.limit) ? Math.trunc(body.limit as number) : 10;
    const limit = Math.min(Math.max(limitRaw, 1), 50);
    const now = new Date();
    const timezone = tenant.timezone || "Europe/Rome";

    let fromIso: string | undefined;
    let toIso: string | undefined;
    if (horizon === "today" || horizon === "tomorrow") {
      const tenantDate = getTenantDateParts(now, timezone);
      const baseUtc = getUtcDateForTenantMidnight(tenantDate, timezone);
      const dayStartUtc = horizon === "today" ? baseUtc : new Date(baseUtc.getTime() + 24 * 60 * 60 * 1000);
      const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);
      fromIso = dayStartUtc.toISOString();
      toIso = new Date(dayEndUtc.getTime() - 1).toISOString();
    } else {
      fromIso = now.toISOString();
    }

    const rawItems = await bookingService.listAdminBookings({
      tenantId,
      fromIso,
      toIso,
      limit: Math.max(20, limit),
      offset: 0
    });
    const statuses = horizon === "next" ? new Set(["pending", "confirmed"]) : new Set(["pending", "confirmed", "completed", "no_show"]);
    const items = rawItems
      .filter((item) => statuses.has(item.status))
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        clientName: item.clientName,
        serviceDisplayName: item.serviceDisplayName,
        status: item.status,
        startAt: item.startAt
      }));

    return c.json({
      data: {
        horizon,
        timezone,
        total: items.length,
        items
      }
    });
  })
  .post("/bookings", async (c) => {
    const body = await c.req.json<{
      serviceId?: string;
      masterId?: string;
      source?: string;
      clientName?: string;
      clientPhoneE164?: string;
      clientEmail?: string;
      clientLocale?: "it" | "en";
      clientConsent?: boolean;
      startAt?: string;
      endAt?: string;
    }>();

    const idempotencyKey = c.req.header("idempotency-key");
    if (!idempotencyKey) {
      throw appError("VALIDATION_ERROR", { reason: "missing idempotency-key header" });
    }

    if (
      !body.serviceId ||
      !body.source ||
      !body.clientName ||
      !body.clientPhoneE164 ||
      !body.clientLocale ||
      !body.startAt ||
      !body.endAt
    ) {
      throw appError("VALIDATION_ERROR", {
        required: [
          "serviceId",
          "source",
          "clientName",
          "clientPhoneE164",
          "clientLocale",
          "startAt",
          "endAt"
        ]
      });
    }

    const tenantId = c.get("tenantId");
    const data = await bookingService.createPublicBooking({
      tenantId,
      serviceId: body.serviceId,
      masterId: body.masterId,
      source: body.source,
      clientName: body.clientName,
      clientPhoneE164: body.clientPhoneE164,
      clientEmail: body.clientEmail,
      clientLocale: body.clientLocale,
      clientConsent: body.clientConsent === true,
      startAtIso: body.startAt,
      endAtIso: body.endAt,
      idempotencyKey
    });

    return c.json({ data }, 201);
  })
  .get("/bookings", async (c) => {
    const clientPhoneE164 = c.req.query("clientPhoneE164");
    const limitRaw = c.req.query("limit");
    if (!clientPhoneE164) {
      throw appError("VALIDATION_ERROR", { required: ["clientPhoneE164"] });
    }

    const tenantId = c.get("tenantId");
    const items = await bookingService.listPublicBookingsByPhone({
      tenantId,
      clientPhoneE164,
      limit: limitRaw ? Number(limitRaw) : undefined
    });

    return c.json({ data: { items } });
  })
  .post("/bookings/:id/cancel", async (c) => {
    const body = await c.req.json<{
      clientPhoneE164?: string;
      reason?: string;
    }>();
    if (!body.clientPhoneE164) {
      throw appError("VALIDATION_ERROR", { required: ["clientPhoneE164"] });
    }

    const tenantId = c.get("tenantId");
    const bookingId = c.req.param("id");
    const data = await bookingService.cancelPublicBooking({
      tenantId,
      bookingId,
      clientPhoneE164: body.clientPhoneE164,
      reason: body.reason
    });

    return c.json({ data });
  })
  .post("/bookings/:id/reschedule", async (c) => {
    const body = await c.req.json<{
      clientPhoneE164?: string;
      serviceId?: string;
      masterId?: string;
      clientLocale?: "it" | "en";
      source?: string;
      startAt?: string;
      endAt?: string;
    }>();

    if (!body.clientPhoneE164 || !body.startAt || !body.endAt) {
      throw appError("VALIDATION_ERROR", {
        required: ["clientPhoneE164", "startAt", "endAt"]
      });
    }

    const idempotencyKey = c.req.header("idempotency-key");
    if (!idempotencyKey) {
      throw appError("VALIDATION_ERROR", { reason: "missing idempotency-key header" });
    }

    const tenantId = c.get("tenantId");
    const bookingId = c.req.param("id");
    const data = await bookingService.reschedulePublicBooking({
      tenantId,
      bookingId,
      clientPhoneE164: body.clientPhoneE164,
      serviceId: body.serviceId,
      masterId: body.masterId,
      clientLocale: body.clientLocale,
      source: body.source,
      startAtIso: body.startAt,
      endAtIso: body.endAt,
      idempotencyKey
    });

    return c.json({ data });
  })
  .post("/bookings/:id/admin-action", async (c) => {
    const internalSecret = c.req.header("x-internal-secret");
    if (!internalSecret || internalSecret !== getApiEnv().internalApiSecret) {
      throw appError("AUTH_FORBIDDEN", { reason: "internal_secret_required" });
    }
    const body = await c.req.json<{
      adminPhoneE164?: string;
      action?: "confirm" | "reject";
      rejectionReason?: string;
    }>();

    if (!body.adminPhoneE164 || !body.action) {
      throw appError("VALIDATION_ERROR", { required: ["adminPhoneE164", "action"] });
    }

    const tenantId = c.get("tenantId");
    const bookingId = c.req.param("id");
    const data = await bookingService.applyPublicAdminAction({
      tenantId,
      bookingId,
      adminPhoneE164: body.adminPhoneE164,
      action: body.action,
      rejectionReason: body.rejectionReason,
      requestId: c.get("requestId")
    });

    return c.json({ data });
  });
