import { and, eq } from "drizzle-orm";
import { webhookEvents } from "@genius/db";
import { getDb } from "../lib/db";

export class WebhookRepository {
  async findByProviderEventId(provider: string, providerEventId: string) {
    const db = getDb();
    const [item] = await db
      .select()
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, provider),
          eq(webhookEvents.providerEventId, providerEventId)
        )
      )
      .limit(1);

    return item ?? null;
  }

  async createReceived(input: {
    provider: string;
    providerEventId: string;
    eventType: string;
    payloadJson: unknown;
    tenantId?: string | null;
  }) {
    const db = getDb();
    const [item] = await db
      .insert(webhookEvents)
      .values({
        tenantId: input.tenantId ?? null,
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        payloadJson: input.payloadJson,
        processingStatus: "received"
      })
      .onConflictDoNothing({
        target: [webhookEvents.provider, webhookEvents.providerEventId]
      })
      .returning();

    return item ?? null;
  }

  async markProcessed(eventId: string) {
    const db = getDb();
    const [item] = await db
      .update(webhookEvents)
      .set({
        processingStatus: "processed",
        processedAt: new Date(),
        errorCode: null,
        errorMessage: null
      })
      .where(eq(webhookEvents.id, eventId))
      .returning();

    return item ?? null;
  }

  async markFailed(input: { eventId: string; errorCode: string; errorMessage: string }) {
    const db = getDb();
    const [item] = await db
      .update(webhookEvents)
      .set({
        processingStatus: "failed",
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        processedAt: new Date()
      })
      .where(eq(webhookEvents.id, input.eventId))
      .returning();

    return item ?? null;
  }
}

