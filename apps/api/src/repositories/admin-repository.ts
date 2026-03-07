import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
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

  async updateMaster(input: {
    tenantId: string;
    masterId: string;
    displayName: string;
    isActive: boolean;
  }) {
    const db = getDb();
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

  async deactivateMaster(input: { tenantId: string; masterId: string }) {
    const db = getDb();
    const [record] = await db
      .update(masters)
      .set({
        isActive: false,
        updatedAt: new Date()
      })
      .where(and(eq(masters.tenantId, input.tenantId), eq(masters.id, input.masterId)))
      .returning();

    return record ?? null;
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

  async createService(input: {
    tenantId: string;
    displayName: string;
    durationMinutes: number;
    priceCents?: number;
    sortOrder?: number;
    isActive?: boolean;
  }) {
    const db = getDb();
    const [record] = await db
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

    return record ?? null;
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
