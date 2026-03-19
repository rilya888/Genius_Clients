import { and, asc, desc, eq, gte, inArray, lt, lte, min, sql } from "drizzle-orm";
import { bookings, masters, services } from "@genius/db";
import { getDb } from "../lib/db";

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";

export class BookingRepository {
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
  }

  async findById(tenantId: string, bookingId: string) {
    const db = getDb();
    const [item] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)))
      .limit(1);

    return item ?? null;
  }

  async updateStatus(input: {
    tenantId: string;
    bookingId: string;
    expectedCurrentStatuses: BookingStatus[];
    nextStatus: BookingStatus;
    cancellationReason?: string | null;
  }) {
    const db = getDb();
    const [item] = await db
      .update(bookings)
      .set({
        status: input.nextStatus,
        cancellationReason: input.cancellationReason,
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
          inArray(bookings.status, ["pending", "confirmed", "completed"]),
          gte(bookings.startAt, input.from),
          lt(bookings.startAt, input.toExclusive)
        )
      );

    return Number(row?.count ?? 0);
  }
}
