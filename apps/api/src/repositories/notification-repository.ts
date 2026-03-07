import { and, asc, eq, inArray } from "drizzle-orm";
import { notificationDeliveries } from "@genius/db";
import { getDb } from "../lib/db";

export class NotificationRepository {
  async enqueue(input: {
    tenantId: string;
    bookingId?: string | null;
    notificationType:
      | "booking_created_admin"
      | "booking_confirmed_client"
      | "booking_reminder_24h"
      | "booking_reminder_2h"
      | "booking_cancelled";
    channel: string;
    recipient: string;
    idempotencyKey: string;
  }) {
    const db = getDb();
    const [record] = await db
      .insert(notificationDeliveries)
      .values({
        tenantId: input.tenantId,
        bookingId: input.bookingId ?? null,
        notificationType: input.notificationType,
        channel: input.channel,
        recipient: input.recipient,
        idempotencyKey: input.idempotencyKey,
        status: "queued"
      })
      .onConflictDoNothing()
      .returning();

    return record ?? null;
  }

  async listQueued(limit: number) {
    const db = getDb();
    return db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.status, "queued"))
      .orderBy(asc(notificationDeliveries.createdAt))
      .limit(limit);
  }

  async markSent(input: { id: string; providerMessageId?: string | null }) {
    const db = getDb();
    const [record] = await db
      .update(notificationDeliveries)
      .set({
        status: "sent",
        providerMessageId: input.providerMessageId ?? null,
        sentAt: new Date(),
        updatedAt: new Date(),
        errorCode: null,
        errorMessage: null
      })
      .where(eq(notificationDeliveries.id, input.id))
      .returning();

    return record ?? null;
  }

  async markFailed(input: { id: string; errorCode: string; errorMessage: string }) {
    const db = getDb();
    const [record] = await db
      .update(notificationDeliveries)
      .set({
        status: "failed",
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
        errorCode: input.errorCode,
        errorMessage: input.errorMessage
      })
      .where(eq(notificationDeliveries.id, input.id))
      .returning();

    return record ?? null;
  }

  async resetFailedToQueued(tenantId: string, limit: number) {
    const db = getDb();
    const failed = await db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.tenantId, tenantId),
          inArray(notificationDeliveries.status, ["failed", "dead_letter"])
        )
      )
      .orderBy(asc(notificationDeliveries.updatedAt))
      .limit(limit);

    const ids = failed.map((item) => item.id);
    if (ids.length === 0) {
      return 0;
    }

    const updated = await db
      .update(notificationDeliveries)
      .set({
        status: "queued",
        nextAttemptAt: null,
        deadLetteredAt: null,
        updatedAt: new Date(),
        errorCode: null,
        errorMessage: null
      })
      .where(inArray(notificationDeliveries.id, ids))
      .returning({ id: notificationDeliveries.id });

    return updated.length;
  }
}
