import { and, asc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import {
  bookings,
  bookingStatusEnum,
  masterServices,
  masters,
  scheduleExceptions,
  services,
  tenants,
  workingHours
} from "@genius/db";
import { getDb } from "../lib/db";

type ActiveBookingStatus = (typeof bookingStatusEnum.enumValues)[number];

export class SlotRepository {
  async findTenantSettings(tenantId: string) {
    const db = getDb();
    const [tenant] = await db
      .select({
        id: tenants.id,
        timezone: tenants.timezone,
        bookingHorizonDays: tenants.bookingHorizonDays,
        bookingMinAdvanceMinutes: tenants.bookingMinAdvanceMinutes,
        bookingBufferMinutes: tenants.bookingBufferMinutes
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    return tenant ?? null;
  }

  async findService(tenantId: string, serviceId: string) {
    const db = getDb();
    const [service] = await db
      .select({
        id: services.id,
        durationMinutes: services.durationMinutes
      })
      .from(services)
      .where(and(eq(services.tenantId, tenantId), eq(services.id, serviceId), eq(services.isActive, true)))
      .limit(1);

    return service ?? null;
  }

  async listMasterCandidates(tenantId: string, serviceId: string, requestedMasterId?: string) {
    const db = getDb();

    const where = [
      eq(masterServices.tenantId, tenantId),
      eq(masterServices.serviceId, serviceId),
      eq(masters.isActive, true)
    ];
    if (requestedMasterId) {
      where.push(eq(masterServices.masterId, requestedMasterId));
    }

    return db
      .select({
        masterId: masters.id,
        durationMinutesOverride: masterServices.durationMinutesOverride
      })
      .from(masterServices)
      .innerJoin(masters, eq(masters.id, masterServices.masterId))
      .where(and(...where))
      .orderBy(asc(masters.displayName));
  }

  async listWorkingHoursForDay(tenantId: string, dayOfWeek: number, masterIds: string[]) {
    if (masterIds.length === 0) {
      return [];
    }

    const db = getDb();
    return db
      .select()
      .from(workingHours)
      .where(
        and(
          eq(workingHours.tenantId, tenantId),
          eq(workingHours.dayOfWeek, dayOfWeek),
          eq(workingHours.isActive, true),
          or(isNull(workingHours.masterId), inArray(workingHours.masterId, masterIds))
        )
      )
      .orderBy(asc(workingHours.startMinute));
  }

  async listScheduleExceptionsForDate(tenantId: string, date: string, masterIds: string[]) {
    if (masterIds.length === 0) {
      return [];
    }

    const db = getDb();
    return db
      .select()
      .from(scheduleExceptions)
      .where(
        and(
          eq(scheduleExceptions.tenantId, tenantId),
          eq(scheduleExceptions.date, date),
          or(isNull(scheduleExceptions.masterId), inArray(scheduleExceptions.masterId, masterIds))
        )
      )
      .orderBy(asc(scheduleExceptions.startMinute));
  }

  async listBusyBookings(
    tenantId: string,
    masterIds: string[],
    rangeStart: Date,
    rangeEnd: Date,
    statuses: ActiveBookingStatus[] = ["pending", "confirmed"]
  ) {
    if (masterIds.length === 0) {
      return [];
    }

    const db = getDb();
    return db
      .select({
        id: bookings.id,
        masterId: bookings.masterId,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        status: bookings.status
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          inArray(bookings.masterId, masterIds),
          inArray(bookings.status, statuses),
          lt(bookings.startAt, rangeEnd),
          gte(bookings.endAt, rangeStart)
        )
      );
  }
}

