import { Hono } from "hono";
import type { ApiAppEnv } from "../../lib/hono-env";
import { appError } from "../../lib/http";
import { BookingService, CatalogService, SlotService } from "../../services";
import { TenantRepository } from "../../repositories";

const catalogService = new CatalogService();
const slotService = new SlotService();
const bookingService = new BookingService();
const tenantRepository = new TenantRepository();

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
        timezone: tenant.timezone
      }
    });
  })
  .get("/masters", async (c) => {
    const tenantId = c.get("tenantId");
    const locale = c.req.query("locale") ?? undefined;
    return c.json({ data: { items: await catalogService.listMasters(tenantId, locale) } });
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
  });
