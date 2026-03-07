import { appError } from "../lib/http";
import { sha256 } from "../lib/hash";
import { assertE164, assertEmail } from "@genius/shared";
import {
  AuditRepository,
  BookingRepository,
  BookingStatus,
  IdempotencyRepository,
  NotificationRepository,
  TenantRepository
} from "../repositories";

export type PublicBookingInput = {
  tenantId: string;
  serviceId: string;
  masterId?: string;
  source: string;
  clientName: string;
  clientPhoneE164: string;
  clientEmail?: string;
  clientLocale: "it" | "en";
  clientConsent: boolean;
  startAtIso: string;
  endAtIso: string;
  idempotencyKey: string;
};

export class BookingService {
  private readonly bookingRepository = new BookingRepository();
  private readonly idempotencyRepository = new IdempotencyRepository();
  private readonly auditRepository = new AuditRepository();
  private readonly tenantRepository = new TenantRepository();
  private readonly notificationRepository = new NotificationRepository();

  private resolveClientChannel(source: string): "email" | "whatsapp" | "telegram" {
    if (source === "whatsapp") {
      return "whatsapp";
    }
    if (source === "telegram") {
      return "telegram";
    }
    return "email";
  }

  async createPublicBooking(input: PublicBookingInput) {
    const clientName = input.clientName.trim();
    const clientPhoneE164 = input.clientPhoneE164.trim();
    const clientEmail = input.clientEmail?.trim().toLowerCase();
    if (!clientName) {
      throw appError("VALIDATION_ERROR", { reason: "client_name_required" });
    }

    if (!input.clientConsent) {
      throw appError("VALIDATION_ERROR", { reason: "client_consent_required" });
    }

    if (!input.idempotencyKey) {
      throw appError("VALIDATION_ERROR", { reason: "idempotency_key_required" });
    }

    if (input.clientLocale !== "it" && input.clientLocale !== "en") {
      throw appError("VALIDATION_ERROR", { reason: "client_locale_invalid" });
    }

    if (input.source !== "web" && input.source !== "whatsapp" && input.source !== "telegram") {
      throw appError("VALIDATION_ERROR", { reason: "booking_source_invalid" });
    }

    try {
      assertE164(clientPhoneE164);
    } catch (error) {
      throw appError("VALIDATION_ERROR", {
        reason: "client_phone_invalid",
        details: error instanceof Error ? error.message : "invalid_phone"
      });
    }

    if (clientEmail) {
      try {
        assertEmail(clientEmail);
      } catch (error) {
        throw appError("VALIDATION_ERROR", {
          reason: "client_email_invalid",
          details: error instanceof Error ? error.message : "invalid_email"
        });
      }
    }

    const startAt = new Date(input.startAtIso);
    const endAt = new Date(input.endAtIso);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw appError("VALIDATION_ERROR", { reason: "booking_datetime_invalid" });
    }
    if (startAt >= endAt) {
      throw appError("VALIDATION_ERROR", { reason: "booking_datetime_range_invalid" });
    }

    const requestHash = sha256(
      JSON.stringify({
        tenantId: input.tenantId,
        serviceId: input.serviceId,
        masterId: input.masterId ?? null,
        source: input.source,
        clientName,
        clientPhoneE164,
        clientEmail: clientEmail ?? null,
        clientLocale: input.clientLocale,
        startAtIso: input.startAtIso,
        endAtIso: input.endAtIso
      })
    );

    const existing = await this.idempotencyRepository.find(input.tenantId, input.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw appError("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
      }

      return existing.responseBody as { bookingId: string; status: "pending" };
    }

    const booking = await this.bookingRepository.create({
      tenantId: input.tenantId,
      serviceId: input.serviceId,
      masterId: input.masterId,
      source: input.source,
      clientName,
      clientPhoneE164,
      clientEmail,
      clientLocale: input.clientLocale,
      clientConsentAt: new Date(),
      startAt,
      endAt
    });

    const responseBody = {
      bookingId: booking.id,
      status: booking.status
    } as { bookingId: string; status: "pending" };

    await this.idempotencyRepository.create({
      tenantId: input.tenantId,
      key: input.idempotencyKey,
      requestHash,
      responseCode: 201,
      responseBody,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    const tenant = await this.tenantRepository.findById(input.tenantId);
    if (tenant?.adminNotificationEmail) {
      await this.notificationRepository.enqueue({
        tenantId: input.tenantId,
        bookingId: booking.id,
        notificationType: "booking_created_admin",
        channel: "email",
        recipient: tenant.adminNotificationEmail,
        idempotencyKey: `${booking.id}:booking_created_admin`
      });
    }

    return responseBody;
  }

  async listAdminBookings(input: {
    tenantId: string;
    status?: BookingStatus;
    fromIso?: string;
    toIso?: string;
    limit?: number;
    offset?: number;
  }) {
    const normalizedLimit =
      input.limit !== undefined && Number.isFinite(input.limit) ? Math.trunc(input.limit) : 20;
    const normalizedOffset =
      input.offset !== undefined && Number.isFinite(input.offset) ? Math.trunc(input.offset) : 0;
    const limit = Math.min(Math.max(normalizedLimit, 1), 100);
    const offset = Math.max(normalizedOffset, 0);

    if (input.fromIso && Number.isNaN(new Date(input.fromIso).getTime())) {
      throw appError("VALIDATION_ERROR", { reason: "from_date_invalid" });
    }
    if (input.toIso && Number.isNaN(new Date(input.toIso).getTime())) {
      throw appError("VALIDATION_ERROR", { reason: "to_date_invalid" });
    }

    return this.bookingRepository.listForAdmin({
      tenantId: input.tenantId,
      status: input.status,
      fromIso: input.fromIso,
      toIso: input.toIso,
      limit,
      offset
    });
  }

  async updateAdminBookingStatus(input: {
    tenantId: string;
    bookingId: string;
    nextStatus: BookingStatus;
    cancellationReason?: string;
    requestId?: string;
    actorUserId?: string;
  }) {
    const current = await this.bookingRepository.findById(input.tenantId, input.bookingId);
    if (!current) {
      throw appError("TENANT_NOT_FOUND", { reason: "booking_not_found_in_tenant" });
    }

    const now = new Date();
    const transitionMap: Record<BookingStatus, BookingStatus[]> = {
      pending: ["confirmed", "cancelled"],
      confirmed: ["completed", "cancelled"],
      completed: [],
      cancelled: []
    };
    const allowedNextStatuses = transitionMap[current.status];

    if (!allowedNextStatuses.includes(input.nextStatus)) {
      throw appError("VALIDATION_ERROR", {
        reason: "booking_status_transition_not_allowed",
        currentStatus: current.status,
        requestedStatus: input.nextStatus
      });
    }

    if (input.nextStatus === "completed" && current.endAt > now) {
      throw appError("VALIDATION_ERROR", { reason: "cannot_complete_future_booking" });
    }
    if (input.nextStatus === "cancelled" && !input.cancellationReason?.trim()) {
      throw appError("VALIDATION_ERROR", { reason: "cancellation_reason_required" });
    }

    const updated = await this.bookingRepository.updateStatus({
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      expectedCurrentStatuses: [current.status],
      nextStatus: input.nextStatus,
      cancellationReason:
        input.nextStatus === "cancelled" ? input.cancellationReason?.trim() : null
    });

    if (!updated) {
      throw appError("CONFLICT", { reason: "booking_status_changed_concurrently" });
    }

    await this.auditRepository.create({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "booking_status_changed",
      entity: "booking",
      entityId: updated.id,
      meta: {
        from: current.status,
        to: input.nextStatus,
        requestId: input.requestId
      }
    });

    if (input.nextStatus === "confirmed") {
      const recipient = updated.clientEmail ?? updated.clientPhoneE164;
      await this.notificationRepository.enqueue({
        tenantId: input.tenantId,
        bookingId: updated.id,
        notificationType: "booking_confirmed_client",
        channel: this.resolveClientChannel(updated.source),
        recipient,
        idempotencyKey: `${updated.id}:booking_confirmed_client`
      });
    }

    if (input.nextStatus === "cancelled") {
      const recipient = updated.clientEmail ?? updated.clientPhoneE164;
      await this.notificationRepository.enqueue({
        tenantId: input.tenantId,
        bookingId: updated.id,
        notificationType: "booking_cancelled",
        channel: this.resolveClientChannel(updated.source),
        recipient,
        idempotencyKey: `${updated.id}:booking_cancelled`
      });
    }

    return updated;
  }

  async cancelPublicBooking(input: {
    tenantId: string;
    bookingId: string;
    clientPhoneE164: string;
    reason?: string;
  }) {
    const clientPhone = input.clientPhoneE164.trim();
    try {
      assertE164(clientPhone);
    } catch (error) {
      throw appError("VALIDATION_ERROR", {
        reason: "client_phone_invalid",
        details: error instanceof Error ? error.message : "invalid_phone"
      });
    }

    const current = await this.bookingRepository.findById(input.tenantId, input.bookingId);
    if (!current) {
      throw appError("TENANT_NOT_FOUND", { reason: "booking_not_found_in_tenant" });
    }
    if (current.clientPhoneE164 !== clientPhone) {
      throw appError("AUTH_FORBIDDEN", { reason: "booking_phone_mismatch" });
    }

    if (current.status !== "pending" && current.status !== "confirmed") {
      throw appError("VALIDATION_ERROR", { reason: "booking_not_cancellable" });
    }

    const updated = await this.bookingRepository.updateStatus({
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      expectedCurrentStatuses: [current.status],
      nextStatus: "cancelled",
      cancellationReason: input.reason?.trim() || "Cancelled by client"
    });
    if (!updated) {
      throw appError("CONFLICT", { reason: "booking_status_changed_concurrently" });
    }

    const recipient = updated.clientEmail ?? updated.clientPhoneE164;
    await this.notificationRepository.enqueue({
      tenantId: input.tenantId,
      bookingId: updated.id,
      notificationType: "booking_cancelled",
      channel: this.resolveClientChannel(updated.source),
      recipient,
      idempotencyKey: `${updated.id}:booking_cancelled`
    });

    return updated;
  }
}
