import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  auditLogs,
  bookings,
  masterServices,
  masterTranslations,
  masters,
  notificationDeliveries,
  scheduleExceptions,
  serviceTranslations,
  services,
  workingHours
} from "@genius/db";
import { getDb } from "../lib/db";

type RevenueSummaryRow = {
  completedCount: number;
  completedWithAmountCount: number;
  completedWithoutAmountCount: number;
  totalRevenueMinor: number;
  averageTicketMinor: number;
};

export class AdminRepository {
  async getNotificationDeliverySummary(tenantId: string) {
    const db = getDb();
    const rows = await db
      .select({
        status: notificationDeliveries.status,
        count: sql<number>`count(*)::int`
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.tenantId, tenantId))
      .groupBy(notificationDeliveries.status);

    const summary = {
      queued: 0,
      sent: 0,
      failed: 0,
      deadLetter: 0,
      total: 0
    };

    for (const row of rows) {
      const count = Number(row.count) || 0;
      summary.total += count;
      if (
        row.status === "queued" ||
        row.status === "sent" ||
        row.status === "failed" ||
        row.status === "dead_letter"
      ) {
        if (row.status === "dead_letter") {
          summary.deadLetter = count;
          continue;
        }
        summary[row.status] = count;
      }
    }

    return summary;
  }

  async listNotificationDeliveries(input: { tenantId: string; limit: number }) {
    const db = getDb();
    return db
      .select({
        id: notificationDeliveries.id,
        bookingId: notificationDeliveries.bookingId,
        notificationType: notificationDeliveries.notificationType,
        channel: notificationDeliveries.channel,
        recipient: notificationDeliveries.recipient,
        status: notificationDeliveries.status,
        attemptCount: notificationDeliveries.attemptCount,
        maxAttempts: notificationDeliveries.maxAttempts,
        nextAttemptAt: notificationDeliveries.nextAttemptAt,
        lastAttemptAt: notificationDeliveries.lastAttemptAt,
        deadLetteredAt: notificationDeliveries.deadLetteredAt,
        errorCode: notificationDeliveries.errorCode,
        errorMessage: notificationDeliveries.errorMessage,
        createdAt: notificationDeliveries.createdAt,
        sentAt: notificationDeliveries.sentAt
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.tenantId, input.tenantId))
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(input.limit);
  }

  async getDashboardKpis(input: { tenantId: string; timezone: string }) {
    const db = getDb();
    const timezone = input.timezone;
    const result = await db.execute<{
      bookingsTodayTotal: number;
      bookingsWeekTotal: number;
      bookingsPendingCount: number;
      bookingsCancelledWeek: number;
      staffActiveCount: number;
      bookedMinutesToday: number;
      bookingsNoShowToday: number;
      completedRevenueTodayMinor: number;
    }>(sql`
      WITH window_bounds AS (
        SELECT
          (date_trunc('day', NOW() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone}) AS day_start_utc,
          ((date_trunc('day', NOW() AT TIME ZONE ${timezone}) + INTERVAL '1 day') AT TIME ZONE ${timezone}) AS day_end_utc,
          ((date_trunc('day', NOW() AT TIME ZONE ${timezone}) - INTERVAL '6 day') AT TIME ZONE ${timezone}) AS week_start_utc
      )
      SELECT
        COALESCE(SUM(CASE
          WHEN b.start_at >= w.day_start_utc AND b.start_at < w.day_end_utc
            AND b.status IN ('pending', 'confirmed', 'completed', 'no_show')
          THEN 1 ELSE 0 END), 0)::int AS "bookingsTodayTotal",
        COALESCE(SUM(CASE
          WHEN b.start_at >= w.week_start_utc AND b.start_at < w.day_end_utc
            AND b.status IN ('pending', 'confirmed', 'completed', 'no_show')
          THEN 1 ELSE 0 END), 0)::int AS "bookingsWeekTotal",
        COALESCE(SUM(CASE
          WHEN b.status = 'pending' THEN 1 ELSE 0 END), 0)::int AS "bookingsPendingCount",
        COALESCE(SUM(CASE
          WHEN b.start_at >= w.week_start_utc AND b.start_at < w.day_end_utc
            AND b.status = 'cancelled'
          THEN 1 ELSE 0 END), 0)::int AS "bookingsCancelledWeek",
        (
          SELECT COALESCE(COUNT(*)::int, 0)
          FROM masters m
          WHERE m.tenant_id = ${input.tenantId} AND m.is_active = TRUE
        ) AS "staffActiveCount",
        COALESCE(SUM(CASE
          WHEN b.start_at >= w.day_start_utc AND b.start_at < w.day_end_utc
            AND b.status IN ('pending', 'confirmed', 'completed', 'no_show')
          THEN GREATEST(0, EXTRACT(EPOCH FROM (b.end_at - b.start_at)) / 60)::int
          ELSE 0 END), 0)::int AS "bookedMinutesToday",
        COALESCE(SUM(CASE
          WHEN b.start_at >= w.day_start_utc AND b.start_at < w.day_end_utc
            AND b.status = 'no_show'
          THEN 1 ELSE 0 END), 0)::int AS "bookingsNoShowToday",
        COALESCE(SUM(CASE
          WHEN b.start_at >= w.day_start_utc AND b.start_at < w.day_end_utc
            AND b.status = 'completed'
          THEN COALESCE(b.completed_amount_minor, 0)
          ELSE 0 END), 0)::int AS "completedRevenueTodayMinor"
      FROM window_bounds w
      LEFT JOIN bookings b ON b.tenant_id = ${input.tenantId}
    `);
    return result.rows[0] ?? null;
  }

  async getRevenueSummary(input: {
    tenantId: string;
    fromAt: Date;
    toAt: Date;
  }) {
    const db = getDb();
    const result = await db.execute<RevenueSummaryRow>(sql`
      SELECT
        COUNT(*)::int AS "completedCount",
        COUNT(*) FILTER (WHERE b.completed_amount_minor IS NOT NULL AND b.completed_amount_minor > 0)::int AS "completedWithAmountCount",
        COUNT(*) FILTER (WHERE b.completed_amount_minor IS NULL OR b.completed_amount_minor <= 0)::int AS "completedWithoutAmountCount",
        COALESCE(SUM(CASE WHEN b.completed_amount_minor IS NOT NULL AND b.completed_amount_minor > 0 THEN b.completed_amount_minor ELSE 0 END), 0)::int AS "totalRevenueMinor",
        COALESCE(AVG(CASE WHEN b.completed_amount_minor IS NOT NULL AND b.completed_amount_minor > 0 THEN b.completed_amount_minor END), 0)::int AS "averageTicketMinor"
      FROM bookings b
      WHERE
        b.tenant_id = ${input.tenantId}
        AND b.status = 'completed'
        AND b.completed_at IS NOT NULL
        AND b.completed_at >= ${input.fromAt}
        AND b.completed_at <= ${input.toAt}
    `);

    return (
      result.rows[0] ?? {
        completedCount: 0,
        completedWithAmountCount: 0,
        completedWithoutAmountCount: 0,
        totalRevenueMinor: 0,
        averageTicketMinor: 0
      }
    );
  }

  async listRevenueBookings(input: {
    tenantId: string;
    fromAt: Date;
    toAt: Date;
    limit: number;
    offset: number;
  }) {
    const db = getDb();
    const rows = await db
      .select({
        id: bookings.id,
        clientName: bookings.clientName,
        serviceId: bookings.serviceId,
        serviceDisplayName: services.displayName,
        startAt: bookings.startAt,
        completedAt: bookings.completedAt,
        completedAmountMinor: bookings.completedAmountMinor,
        completedCurrency: bookings.completedCurrency,
        completedPaymentMethod: bookings.completedPaymentMethod,
        completedPaymentNote: bookings.completedPaymentNote
      })
      .from(bookings)
      .innerJoin(services, eq(services.id, bookings.serviceId))
      .where(
        and(
          eq(bookings.tenantId, input.tenantId),
          eq(bookings.status, "completed"),
          sql`${bookings.completedAt} IS NOT NULL`,
          sql`${bookings.completedAt} >= ${input.fromAt}`,
          sql`${bookings.completedAt} <= ${input.toAt}`
        )
      )
      .orderBy(desc(bookings.completedAt), desc(bookings.updatedAt))
      .limit(input.limit)
      .offset(input.offset);

    return rows;
  }

  async getDashboardAttention(input: { tenantId: string }) {
    const db = getDb();
    const result = await db.execute<{
      servicesWithoutMasters: number;
      mastersWithoutSchedule: number;
      pendingBookings: number;
    }>(sql`
      SELECT
        (
          SELECT COALESCE(COUNT(*)::int, 0)
          FROM services s
          WHERE
            s.tenant_id = ${input.tenantId}
            AND s.is_active = TRUE
            AND NOT EXISTS (
              SELECT 1
              FROM master_services ms
              INNER JOIN masters m ON m.id = ms.master_id
              WHERE ms.tenant_id = s.tenant_id AND ms.service_id = s.id AND m.is_active = TRUE
            )
        ) AS "servicesWithoutMasters",
        (
          SELECT COALESCE(COUNT(*)::int, 0)
          FROM masters m
          WHERE
            m.tenant_id = ${input.tenantId}
            AND m.is_active = TRUE
            AND NOT EXISTS (
              SELECT 1
              FROM working_hours wh
              WHERE wh.tenant_id = m.tenant_id AND wh.master_id = m.id AND wh.is_active = TRUE
            )
        ) AS "mastersWithoutSchedule",
        (
          SELECT COALESCE(COUNT(*)::int, 0)
          FROM bookings b
          WHERE b.tenant_id = ${input.tenantId} AND b.status = 'pending'
        ) AS "pendingBookings"
    `);

    return result.rows[0] ?? {
      servicesWithoutMasters: 0,
      mastersWithoutSchedule: 0,
      pendingBookings: 0
    };
  }

  async listRecentActivity(input: { tenantId: string; limit: number }) {
    const db = getDb();
    return db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entity: auditLogs.entity,
        createdAt: auditLogs.createdAt
      })
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, input.tenantId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(input.limit);
  }

  async listMasters(tenantId: string) {
    const db = getDb();
    return db
      .select({
        id: masters.id,
        displayName: masters.displayName,
        isActive: masters.isActive,
        createdAt: masters.createdAt,
        updatedAt: masters.updatedAt
      })
      .from(masters)
      .where(eq(masters.tenantId, tenantId))
      .orderBy(asc(masters.displayName));
  }

  async listActiveMasters(tenantId: string) {
    const db = getDb();
    return db
      .select({
        id: masters.id,
        displayName: masters.displayName
      })
      .from(masters)
      .where(and(eq(masters.tenantId, tenantId), eq(masters.isActive, true)))
      .orderBy(asc(masters.displayName));
  }

  async countActiveMastersByTenant(tenantId: string): Promise<number> {
    const db = getDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(masters)
      .where(and(eq(masters.tenantId, tenantId), eq(masters.isActive, true)));

    return Number(row?.count ?? 0);
  }

  async createMaster(input: { tenantId: string; displayName: string; isActive?: boolean }) {
    const db = getDb();
    const [record] = await db
      .insert(masters)
      .values({
        tenantId: input.tenantId,
        displayName: input.displayName,
        isActive: input.isActive ?? true
      })
      .returning();

    return record ?? null;
  }

  async findMasterByDisplayName(input: {
    tenantId: string;
    displayName: string;
    excludeMasterId?: string;
  }) {
    const db = getDb();
    const filters = [
      eq(masters.tenantId, input.tenantId),
      sql`lower(${masters.displayName}) = lower(${input.displayName})`
    ];

    if (input.excludeMasterId) {
      filters.push(ne(masters.id, input.excludeMasterId));
    }

    const [record] = await db
      .select({
        id: masters.id,
        displayName: masters.displayName
      })
      .from(masters)
      .where(and(...filters))
      .limit(1);

    return record ?? null;
  }

  async updateMaster(input: {
    tenantId: string;
    masterId: string;
    displayName: string;
    isActive: boolean;
  }) {
    const db = getDb();
    if (input.isActive) {
      const [record] = await db
        .update(masters)
        .set({
          displayName: input.displayName,
          isActive: input.isActive,
          updatedAt: new Date()
        })
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.id, input.masterId)))
        .returning();

      return record ?? null;
    }

    return db.transaction(async (tx) => {
      const [record] = await tx
        .update(masters)
        .set({
          displayName: input.displayName,
          isActive: false,
          updatedAt: new Date()
        })
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.id, input.masterId)))
        .returning();

      if (!record) {
        return null;
      }

      await tx
        .delete(masterServices)
        .where(and(eq(masterServices.tenantId, input.tenantId), eq(masterServices.masterId, input.masterId)));

      return record;
    });
  }

  async deactivateMaster(input: { tenantId: string; masterId: string }) {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [record] = await tx
        .update(masters)
        .set({
          isActive: false,
          updatedAt: new Date()
        })
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.id, input.masterId)))
        .returning();

      if (!record) {
        return null;
      }

      await tx
        .delete(masterServices)
        .where(and(eq(masterServices.tenantId, input.tenantId), eq(masterServices.masterId, input.masterId)));

      return record;
    });
  }

  async listServices(tenantId: string) {
    const db = getDb();
    return db
      .select({
        id: services.id,
        displayName: services.displayName,
        durationMinutes: services.durationMinutes,
        priceCents: services.priceCents,
        sortOrder: services.sortOrder,
        isActive: services.isActive,
        createdAt: services.createdAt,
        updatedAt: services.updatedAt
      })
      .from(services)
      .where(eq(services.tenantId, tenantId))
      .orderBy(asc(services.sortOrder), asc(services.displayName));
  }

  async findServiceById(input: { tenantId: string; serviceId: string }) {
    const db = getDb();
    const [record] = await db
      .select({
        id: services.id,
        isActive: services.isActive
      })
      .from(services)
      .where(and(eq(services.tenantId, input.tenantId), eq(services.id, input.serviceId)))
      .limit(1);

    return record ?? null;
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
    const db = getDb();
    const masterIds = input.masterIds ?? [];
    return db.transaction(async (tx) => {
      const [record] = await tx
        .insert(services)
        .values({
          tenantId: input.tenantId,
          displayName: input.displayName,
          durationMinutes: input.durationMinutes,
          priceCents: input.priceCents,
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true
        })
        .returning();

      if (!record) {
        return null;
      }

      if (masterIds.length > 0) {
        await tx.insert(masterServices).values(
          masterIds.map((masterId) => ({
            tenantId: input.tenantId,
            serviceId: record.id,
            masterId
          }))
        );
      }

      return record;
    });
  }

  async listMasterTranslations(tenantId: string) {
    const db = getDb();
    return db
      .select({
        masterId: masterTranslations.masterId,
        locale: masterTranslations.locale,
        displayName: masterTranslations.displayName,
        bio: masterTranslations.bio,
        createdAt: masterTranslations.createdAt,
        updatedAt: masterTranslations.updatedAt
      })
      .from(masterTranslations)
      .innerJoin(masters, eq(masters.id, masterTranslations.masterId))
      .where(eq(masters.tenantId, tenantId))
      .orderBy(asc(masterTranslations.locale), asc(masterTranslations.displayName));
  }

  async upsertMasterTranslation(input: {
    tenantId: string;
    masterId: string;
    locale: string;
    displayName: string;
    bio?: string | null;
  }) {
    const db = getDb();
    const [ownerMaster] = await db
      .select({ id: masters.id })
      .from(masters)
      .where(and(eq(masters.tenantId, input.tenantId), eq(masters.id, input.masterId)))
      .limit(1);

    if (!ownerMaster) {
      return null;
    }

    const [record] = await db
      .insert(masterTranslations)
      .values({
        masterId: input.masterId,
        locale: input.locale,
        displayName: input.displayName,
        bio: input.bio ?? null
      })
      .onConflictDoUpdate({
        target: [masterTranslations.masterId, masterTranslations.locale],
        set: {
          displayName: input.displayName,
          bio: input.bio ?? null,
          updatedAt: new Date()
        }
      })
      .returning();

    return record ?? null;
  }

  async deleteMasterTranslation(input: { tenantId: string; masterId: string; locale: string }) {
    const db = getDb();
    const [ownerMaster] = await db
      .select({ id: masters.id })
      .from(masters)
      .where(and(eq(masters.tenantId, input.tenantId), eq(masters.id, input.masterId)))
      .limit(1);

    if (!ownerMaster) {
      return null;
    }

    const [record] = await db
      .delete(masterTranslations)
      .where(
        and(
          eq(masterTranslations.masterId, input.masterId),
          eq(masterTranslations.locale, input.locale)
        )
      )
      .returning();

    return record ?? null;
  }

  async listServiceTranslations(tenantId: string) {
    const db = getDb();
    return db
      .select({
        serviceId: serviceTranslations.serviceId,
        locale: serviceTranslations.locale,
        displayName: serviceTranslations.displayName,
        description: serviceTranslations.description,
        createdAt: serviceTranslations.createdAt,
        updatedAt: serviceTranslations.updatedAt
      })
      .from(serviceTranslations)
      .innerJoin(services, eq(services.id, serviceTranslations.serviceId))
      .where(eq(services.tenantId, tenantId))
      .orderBy(asc(serviceTranslations.locale), asc(serviceTranslations.displayName));
  }

  async upsertServiceTranslation(input: {
    tenantId: string;
    serviceId: string;
    locale: string;
    displayName: string;
    description?: string | null;
  }) {
    const db = getDb();
    const [ownerService] = await db
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.tenantId, input.tenantId), eq(services.id, input.serviceId)))
      .limit(1);

    if (!ownerService) {
      return null;
    }

    const [record] = await db
      .insert(serviceTranslations)
      .values({
        serviceId: input.serviceId,
        locale: input.locale,
        displayName: input.displayName,
        description: input.description ?? null
      })
      .onConflictDoUpdate({
        target: [serviceTranslations.serviceId, serviceTranslations.locale],
        set: {
          displayName: input.displayName,
          description: input.description ?? null,
          updatedAt: new Date()
        }
      })
      .returning();

    return record ?? null;
  }

  async deleteServiceTranslation(input: { tenantId: string; serviceId: string; locale: string }) {
    const db = getDb();
    const [ownerService] = await db
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.tenantId, input.tenantId), eq(services.id, input.serviceId)))
      .limit(1);

    if (!ownerService) {
      return null;
    }

    const [record] = await db
      .delete(serviceTranslations)
      .where(
        and(
          eq(serviceTranslations.serviceId, input.serviceId),
          eq(serviceTranslations.locale, input.locale)
        )
      )
      .returning();

    return record ?? null;
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
    const db = getDb();
    const [record] = await db
      .update(services)
      .set({
        displayName: input.displayName,
        durationMinutes: input.durationMinutes,
        priceCents: input.priceCents,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        updatedAt: new Date()
      })
      .where(and(eq(services.tenantId, input.tenantId), eq(services.id, input.serviceId)))
      .returning();

    return record ?? null;
  }

  async deactivateService(input: { tenantId: string; serviceId: string }) {
    const db = getDb();
    const [record] = await db
      .update(services)
      .set({
        isActive: false,
        updatedAt: new Date()
      })
      .where(and(eq(services.tenantId, input.tenantId), eq(services.id, input.serviceId)))
      .returning();

    return record ?? null;
  }

  async listMasterServices(tenantId: string) {
    const db = getDb();
    return db
      .select({
        id: masterServices.id,
        masterId: masterServices.masterId,
        serviceId: masterServices.serviceId,
        durationMinutesOverride: masterServices.durationMinutesOverride,
        createdAt: masterServices.createdAt
      })
      .from(masterServices)
      .where(eq(masterServices.tenantId, tenantId))
      .orderBy(asc(masterServices.createdAt));
  }

  async listServiceMasterIds(input: { tenantId: string; serviceId: string }) {
    const db = getDb();
    const rows = await db
      .select({
        masterId: masterServices.masterId
      })
      .from(masterServices)
      .where(and(eq(masterServices.tenantId, input.tenantId), eq(masterServices.serviceId, input.serviceId)));
    return rows.map((row) => row.masterId);
  }

  async countActiveMasterMappingsByService(input: { tenantId: string; serviceId: string; masterIds?: string[] }) {
    const db = getDb();
    const filters = [
      eq(masterServices.tenantId, input.tenantId),
      eq(masterServices.serviceId, input.serviceId),
      eq(masters.isActive, true),
      eq(masters.tenantId, input.tenantId)
    ];
    if (input.masterIds && input.masterIds.length > 0) {
      filters.push(inArray(masterServices.masterId, input.masterIds));
    }

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(masterServices)
      .innerJoin(masters, eq(masters.id, masterServices.masterId))
      .where(and(...filters));

    return Number(row?.count ?? 0);
  }

  async replaceServiceMasterMappings(input: { tenantId: string; serviceId: string; masterIds: string[] }) {
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx
        .delete(masterServices)
        .where(and(eq(masterServices.tenantId, input.tenantId), eq(masterServices.serviceId, input.serviceId)));

      if (input.masterIds.length === 0) {
        return;
      }

      await tx.insert(masterServices).values(
        input.masterIds.map((masterId) => ({
          tenantId: input.tenantId,
          serviceId: input.serviceId,
          masterId
        }))
      );
    });
  }

  async createMasterService(input: {
    tenantId: string;
    masterId: string;
    serviceId: string;
    durationMinutesOverride?: number;
  }) {
    const db = getDb();
    const [record] = await db
      .insert(masterServices)
      .values({
        tenantId: input.tenantId,
        masterId: input.masterId,
        serviceId: input.serviceId,
        durationMinutesOverride: input.durationMinutesOverride
      })
      .returning();

    return record ?? null;
  }

  async updateMasterService(input: {
    tenantId: string;
    id: string;
    masterId: string;
    serviceId: string;
    durationMinutesOverride: number | null;
  }) {
    const db = getDb();
    const [record] = await db
      .update(masterServices)
      .set({
        masterId: input.masterId,
        serviceId: input.serviceId,
        durationMinutesOverride: input.durationMinutesOverride
      })
      .where(and(eq(masterServices.tenantId, input.tenantId), eq(masterServices.id, input.id)))
      .returning();

    return record ?? null;
  }

  async deleteMasterService(input: { tenantId: string; id: string }) {
    const db = getDb();
    const [record] = await db
      .delete(masterServices)
      .where(and(eq(masterServices.tenantId, input.tenantId), eq(masterServices.id, input.id)))
      .returning();

    return record ?? null;
  }

  async listWorkingHours(tenantId: string) {
    const db = getDb();
    return db
      .select()
      .from(workingHours)
      .where(eq(workingHours.tenantId, tenantId))
      .orderBy(asc(workingHours.dayOfWeek), asc(workingHours.startMinute));
  }

  async createWorkingHours(input: {
    tenantId: string;
    masterId?: string;
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
    isActive?: boolean;
  }) {
    const db = getDb();
    const [record] = await db
      .insert(workingHours)
      .values({
        tenantId: input.tenantId,
        masterId: input.masterId,
        dayOfWeek: input.dayOfWeek,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        isActive: input.isActive ?? true
      })
      .returning();

    return record ?? null;
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
    const db = getDb();
    const [record] = await db
      .update(workingHours)
      .set({
        masterId: input.masterId,
        dayOfWeek: input.dayOfWeek,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        isActive: input.isActive,
        updatedAt: new Date()
      })
      .where(and(eq(workingHours.tenantId, input.tenantId), eq(workingHours.id, input.id)))
      .returning();

    return record ?? null;
  }

  async deleteWorkingHours(input: { tenantId: string; id: string }) {
    const db = getDb();
    const [record] = await db
      .delete(workingHours)
      .where(and(eq(workingHours.tenantId, input.tenantId), eq(workingHours.id, input.id)))
      .returning();

    return record ?? null;
  }

  async listScheduleExceptions(tenantId: string) {
    const db = getDb();
    return db
      .select()
      .from(scheduleExceptions)
      .where(eq(scheduleExceptions.tenantId, tenantId))
      .orderBy(asc(scheduleExceptions.date), asc(scheduleExceptions.startMinute));
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
    const db = getDb();
    const [record] = await db
      .insert(scheduleExceptions)
      .values({
        tenantId: input.tenantId,
        masterId: input.masterId,
        date: input.date,
        isClosed: input.isClosed ?? false,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        note: input.note
      })
      .returning();

    return record ?? null;
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
    const db = getDb();
    const [record] = await db
      .update(scheduleExceptions)
      .set({
        masterId: input.masterId,
        date: input.date,
        isClosed: input.isClosed,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        note: input.note,
        updatedAt: new Date()
      })
      .where(and(eq(scheduleExceptions.tenantId, input.tenantId), eq(scheduleExceptions.id, input.id)))
      .returning();

    return record ?? null;
  }

  async deleteScheduleException(input: { tenantId: string; id: string }) {
    const db = getDb();
    const [record] = await db
      .delete(scheduleExceptions)
      .where(and(eq(scheduleExceptions.tenantId, input.tenantId), eq(scheduleExceptions.id, input.id)))
      .returning();

    return record ?? null;
  }
}
