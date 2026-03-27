import { and, asc, desc, eq, gte, inArray, lt, lte, min, sql } from "drizzle-orm";
import { bookings, masterServices, masters, services } from "@genius/db";
import { getDb } from "../lib/db";

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled" | "rejected" | "no_show";

export class BookingRepository {
  private isMissingColumnError(error: unknown) {
    if (typeof error !== "object" || error === null) {
      return false;
    }
    if ("code" in error && String((error as { code: unknown }).code) === "42703") {
      return true;
    }
    if ("cause" in error) {
      const cause = (error as { cause?: unknown }).cause;
      if (typeof cause === "object" && cause !== null && "code" in cause) {
        return String((cause as { code: unknown }).code) === "42703";
      }
    }
    return false;
  }

  async hasActiveMasterMappingsForService(input: { tenantId: string; serviceId: string }) {
    const db = getDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(masterServices)
      .innerJoin(
        services,
        and(
          eq(services.id, masterServices.serviceId),
          eq(services.tenantId, masterServices.tenantId),
          eq(services.isActive, true)
        )
      )
      .innerJoin(
        masters,
        and(
          eq(masters.id, masterServices.masterId),
          eq(masters.tenantId, masterServices.tenantId),
          eq(masters.isActive, true)
        )
      )
      .where(and(eq(masterServices.tenantId, input.tenantId), eq(masterServices.serviceId, input.serviceId)));

    return Number(row?.count ?? 0) > 0;
  }

  async isServiceMasterPairAllowed(input: { tenantId: string; serviceId: string; masterId: string }) {
    const db = getDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(masterServices)
      .innerJoin(
        services,
        and(
          eq(services.id, masterServices.serviceId),
          eq(services.tenantId, masterServices.tenantId),
          eq(services.isActive, true)
        )
      )
      .innerJoin(
        masters,
        and(
          eq(masters.id, masterServices.masterId),
          eq(masters.tenantId, masterServices.tenantId),
          eq(masters.isActive, true)
        )
      )
      .where(
        and(
          eq(masterServices.tenantId, input.tenantId),
          eq(masterServices.serviceId, input.serviceId),
          eq(masterServices.masterId, input.masterId)
        )
      );

    return Number(row?.count ?? 0) > 0;
  }

  async create(input: {
    tenantId: string;
    serviceId: string;
    masterId?: string;
    source: string;
    clientName: string;
    clientPhoneE164: string;
    clientEmail?: string;
    clientLocale: string;
    clientConsentAt: Date;
    startAt: Date;
    endAt: Date;
  }) {
    const db = getDb();
    const [booking] = await db
      .insert(bookings)
      .values({
        tenantId: input.tenantId,
        serviceId: input.serviceId,
        masterId: input.masterId,
        source: input.source,
        clientName: input.clientName,
        clientPhoneE164: input.clientPhoneE164,
        clientEmail: input.clientEmail,
        clientLocale: input.clientLocale,
        clientConsentAt: input.clientConsentAt,
        startAt: input.startAt,
        endAt: input.endAt
      })
      .returning();

    return booking;
  }

  async listForAdmin(input: {
    tenantId: string;
    status?: BookingStatus;
    fromIso?: string;
    toIso?: string;
    limit: number;
    offset: number;
  }) {
    const db = getDb();
    const filters = [eq(bookings.tenantId, input.tenantId)];

    if (input.status) {
      filters.push(eq(bookings.status, input.status));
    }
    if (input.fromIso) {
      filters.push(gte(bookings.startAt, new Date(input.fromIso)));
    }
    if (input.toIso) {
      filters.push(lte(bookings.startAt, new Date(input.toIso)));
    }

    try {
      const items = await db
        .select({
          id: bookings.id,
          serviceId: bookings.serviceId,
          serviceDisplayName: services.displayName,
          masterId: bookings.masterId,
          masterDisplayName: masters.displayName,
          status: bookings.status,
          source: bookings.source,
          clientName: bookings.clientName,
          clientPhoneE164: bookings.clientPhoneE164,
          clientEmail: bookings.clientEmail,
          clientLocale: bookings.clientLocale,
          startAt: bookings.startAt,
          endAt: bookings.endAt,
          cancellationReason: bookings.cancellationReason,
          cancellationReasonCategory: bookings.cancellationReasonCategory,
          rejectionReason: bookings.rejectionReason,
          completedAt: bookings.completedAt,
          completedAmountMinor: bookings.completedAmountMinor,
          completedCurrency: bookings.completedCurrency,
          completedPaymentMethod: bookings.completedPaymentMethod,
          completedPaymentNote: bookings.completedPaymentNote,
          completedByUserId: bookings.completedByUserId,
          createdAt: bookings.createdAt,
          updatedAt: bookings.updatedAt
        })
        .from(bookings)
        .innerJoin(services, eq(services.id, bookings.serviceId))
        .leftJoin(masters, eq(masters.id, bookings.masterId))
        .where(and(...filters))
        .orderBy(desc(bookings.startAt), asc(bookings.id))
        .limit(input.limit)
        .offset(input.offset);
      return items;
    } catch (error) {
      if (!this.isMissingColumnError(error)) {
        throw error;
      }
      // Backward-compatible fallback for databases where completion columns are not migrated yet.
      const legacyItems = await db
        .select({
          id: bookings.id,
          serviceId: bookings.serviceId,
          serviceDisplayName: services.displayName,
          masterId: bookings.masterId,
          masterDisplayName: masters.displayName,
          status: bookings.status,
          source: bookings.source,
          clientName: bookings.clientName,
          clientPhoneE164: bookings.clientPhoneE164,
          clientEmail: bookings.clientEmail,
          clientLocale: bookings.clientLocale,
          startAt: bookings.startAt,
          endAt: bookings.endAt,
          cancellationReason: bookings.cancellationReason,
          cancellationReasonCategory: bookings.cancellationReasonCategory,
          rejectionReason: bookings.rejectionReason,
          createdAt: bookings.createdAt,
          updatedAt: bookings.updatedAt
        })
        .from(bookings)
        .innerJoin(services, eq(services.id, bookings.serviceId))
        .leftJoin(masters, eq(masters.id, bookings.masterId))
        .where(and(...filters))
        .orderBy(desc(bookings.startAt), asc(bookings.id))
        .limit(input.limit)
        .offset(input.offset);
      return legacyItems.map((item) => ({
        ...item,
        cancellationReasonCategory: null,
        completedAt: null,
        completedAmountMinor: null,
        completedCurrency: null,
        completedPaymentMethod: null,
        completedPaymentNote: null,
        completedByUserId: null
      }));
    }
  }

  async findById(tenantId: string, bookingId: string) {
    const db = getDb();
    try {
      const [item] = await db
        .select({
          id: bookings.id,
          tenantId: bookings.tenantId,
          serviceId: bookings.serviceId,
          masterId: bookings.masterId,
          status: bookings.status,
          source: bookings.source,
          clientName: bookings.clientName,
          clientPhoneE164: bookings.clientPhoneE164,
          clientEmail: bookings.clientEmail,
          clientLocale: bookings.clientLocale,
          clientConsentAt: bookings.clientConsentAt,
          startAt: bookings.startAt,
          endAt: bookings.endAt,
          reminder24hSentAt: bookings.reminder24hSentAt,
          reminder2hSentAt: bookings.reminder2hSentAt,
          cancellationReason: bookings.cancellationReason,
          cancellationReasonCategory: bookings.cancellationReasonCategory,
          rejectionReason: bookings.rejectionReason,
          completedAt: bookings.completedAt,
          completedAmountMinor: bookings.completedAmountMinor,
          completedCurrency: bookings.completedCurrency,
          completedPaymentMethod: bookings.completedPaymentMethod,
          completedPaymentNote: bookings.completedPaymentNote,
          completedByUserId: bookings.completedByUserId,
          createdAt: bookings.createdAt,
          updatedAt: bookings.updatedAt
        })
        .from(bookings)
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)))
        .limit(1);
      return item ?? null;
    } catch (error) {
      if (!this.isMissingColumnError(error)) {
        throw error;
      }
      const [legacyItem] = await db
        .select({
          id: bookings.id,
          tenantId: bookings.tenantId,
          serviceId: bookings.serviceId,
          masterId: bookings.masterId,
          status: bookings.status,
          source: bookings.source,
          clientName: bookings.clientName,
          clientPhoneE164: bookings.clientPhoneE164,
          clientEmail: bookings.clientEmail,
          clientLocale: bookings.clientLocale,
          clientConsentAt: bookings.clientConsentAt,
          startAt: bookings.startAt,
          endAt: bookings.endAt,
          reminder24hSentAt: bookings.reminder24hSentAt,
          reminder2hSentAt: bookings.reminder2hSentAt,
          cancellationReason: bookings.cancellationReason,
          rejectionReason: bookings.rejectionReason,
          completedAt: bookings.completedAt,
          completedAmountMinor: bookings.completedAmountMinor,
          completedCurrency: bookings.completedCurrency,
          completedPaymentMethod: bookings.completedPaymentMethod,
          completedPaymentNote: bookings.completedPaymentNote,
          completedByUserId: bookings.completedByUserId,
          createdAt: bookings.createdAt,
          updatedAt: bookings.updatedAt
        })
        .from(bookings)
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)))
        .limit(1);
      return legacyItem ? { ...legacyItem, cancellationReasonCategory: null } : null;
    }
  }

  async updateStatus(input: {
    tenantId: string;
    bookingId: string;
    expectedCurrentStatuses: BookingStatus[];
    nextStatus: BookingStatus;
    cancellationReason?: string | null;
    cancellationReasonCategory?: string | null;
    rejectionReason?: string | null;
    completedAt?: Date | null;
    completedAmountMinor?: number | null;
    completedCurrency?: string | null;
    completedPaymentMethod?: string | null;
    completedPaymentNote?: string | null;
    completedByUserId?: string | null;
  }) {
    const db = getDb();
    try {
      const [item] = await db
        .update(bookings)
        .set({
          status: input.nextStatus,
          cancellationReason: input.cancellationReason,
          cancellationReasonCategory: input.cancellationReasonCategory,
          rejectionReason: input.rejectionReason,
          completedAt: input.completedAt,
          completedAmountMinor: input.completedAmountMinor,
          completedCurrency: input.completedCurrency,
          completedPaymentMethod: input.completedPaymentMethod,
          completedPaymentNote: input.completedPaymentNote,
          completedByUserId: input.completedByUserId,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(bookings.tenantId, input.tenantId),
            eq(bookings.id, input.bookingId),
            inArray(bookings.status, input.expectedCurrentStatuses)
          )
        )
        .returning();
      return item ?? null;
    } catch (error) {
      if (!this.isMissingColumnError(error)) {
        throw error;
      }
      const [legacyItem] = await db
        .update(bookings)
        .set({
          status: input.nextStatus,
          cancellationReason: input.cancellationReason,
          rejectionReason: input.rejectionReason,
          completedAt: input.completedAt,
          completedAmountMinor: input.completedAmountMinor,
          completedCurrency: input.completedCurrency,
          completedPaymentMethod: input.completedPaymentMethod,
          completedPaymentNote: input.completedPaymentNote,
          completedByUserId: input.completedByUserId,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(bookings.tenantId, input.tenantId),
            eq(bookings.id, input.bookingId),
            inArray(bookings.status, input.expectedCurrentStatuses)
          )
        )
        .returning();
      return legacyItem ? { ...legacyItem, cancellationReasonCategory: null } : null;
    }
  }

  async listUpcomingByPhone(input: {
    tenantId: string;
    clientPhoneE164: string;
    statuses: BookingStatus[];
    now: Date;
    limit: number;
  }) {
    const db = getDb();
    return db
      .select({
        id: bookings.id,
        serviceId: bookings.serviceId,
        masterId: bookings.masterId,
        status: bookings.status,
        source: bookings.source,
        clientName: bookings.clientName,
        clientPhoneE164: bookings.clientPhoneE164,
        clientEmail: bookings.clientEmail,
        clientLocale: bookings.clientLocale,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        createdAt: bookings.createdAt,
        updatedAt: bookings.updatedAt
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, input.tenantId),
          eq(bookings.clientPhoneE164, input.clientPhoneE164),
          inArray(bookings.status, input.statuses),
          gte(bookings.startAt, input.now)
        )
      )
      .orderBy(asc(bookings.startAt), asc(bookings.id))
      .limit(input.limit);
  }

  async getUpcomingConfirmedImpactByMaster(input: {
    tenantId: string;
    masterId: string;
    now: Date;
  }) {
    const db = getDb();
    const [row] = await db
      .select({
        upcomingConfirmedCount: sql<number>`count(*)::int`,
        earliestStartAt: min(bookings.startAt)
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, input.tenantId),
          eq(bookings.masterId, input.masterId),
          eq(bookings.status, "confirmed"),
          gte(bookings.startAt, input.now)
        )
      );

    return {
      upcomingConfirmedCount: Number(row?.upcomingConfirmedCount ?? 0),
      earliestStartAt: row?.earliestStartAt ?? null
    };
  }

  async countTenantBookingsInRange(input: { tenantId: string; from: Date; toExclusive: Date }) {
    const db = getDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, input.tenantId),
          inArray(bookings.status, ["pending", "confirmed", "completed", "no_show"]),
          gte(bookings.startAt, input.from),
          lt(bookings.startAt, input.toExclusive)
        )
      );

    return Number(row?.count ?? 0);
  }
}
