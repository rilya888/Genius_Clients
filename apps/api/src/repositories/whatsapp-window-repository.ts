import { and, eq, lte } from "drizzle-orm";
import { whatsappContactWindows } from "@genius/db";
import { getDb } from "../lib/db";

export class WhatsAppWindowRepository {
  async touchInbound(input: {
    tenantId: string;
    senderPhoneNumberId: string;
    recipientE164: string;
    inboundAt: Date;
    locale?: string | null;
  }) {
    const db = getDb();
    const normalizedLocale = input.locale === "it" || input.locale === "en" ? input.locale : null;

    const [updated] = await db
      .update(whatsappContactWindows)
      .set({
        lastInboundAt: input.inboundAt,
        lastKnownLocale: normalizedLocale ?? undefined,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(whatsappContactWindows.tenantId, input.tenantId),
          eq(whatsappContactWindows.senderPhoneNumberId, input.senderPhoneNumberId),
          eq(whatsappContactWindows.recipientE164, input.recipientE164),
          lte(whatsappContactWindows.lastInboundAt, input.inboundAt)
        )
      )
      .returning();
    if (updated) {
      return updated;
    }

    const [inserted] = await db
      .insert(whatsappContactWindows)
      .values({
        tenantId: input.tenantId,
        senderPhoneNumberId: input.senderPhoneNumberId,
        recipientE164: input.recipientE164,
        lastInboundAt: input.inboundAt,
        lastKnownLocale: normalizedLocale
      })
      .onConflictDoUpdate({
        target: [
          whatsappContactWindows.tenantId,
          whatsappContactWindows.senderPhoneNumberId,
          whatsappContactWindows.recipientE164
        ],
        set: {
          lastInboundAt: input.inboundAt,
          lastKnownLocale: normalizedLocale ?? undefined,
          updatedAt: new Date()
        }
      })
      .returning();

    return inserted ?? null;
  }
}
