import { eq } from "drizzle-orm";
import { tenants } from "@genius/db";
import { getDb } from "../lib/db";

export class TenantRepository {
  async create(input: {
    slug: string;
    name: string;
    defaultLocale?: string;
    timezone?: string;
  }) {
    const db = getDb();
    const [tenant] = await db
      .insert(tenants)
      .values({
        slug: input.slug,
        name: input.name,
        defaultLocale: input.defaultLocale ?? "it",
        timezone: input.timezone ?? "Europe/Rome",
        openaiEnabled: true,
        openaiModel: "gpt-5-mini",
        humanHandoffEnabled: true
      })
      .returning();

    return tenant;
  }

  async findBySlug(slug: string) {
    const db = getDb();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return tenant ?? null;
  }

  async findById(id: string) {
    const db = getDb();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return tenant ?? null;
  }

  async updateSettings(input: {
    tenantId: string;
    defaultLocale?: string;
    timezone?: string;
    bookingHorizonDays?: number;
    bookingMinAdvanceMinutes?: number;
    bookingBufferMinutes?: number;
    addressCountry?: string | null;
    addressCity?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    addressPostalCode?: string | null;
    parkingAvailable?: boolean | null;
    parkingNote?: string | null;
    businessHoursNote?: string | null;
    adminNotificationEmail?: string | null;
    adminNotificationTelegramChatId?: number | null;
    adminNotificationWhatsappE164?: string | null;
    desiredWhatsappBotE164?: string | null;
    operatorWhatsappE164?: string | null;
    openaiEnabled?: boolean;
    openaiModel?: string;
    humanHandoffEnabled?: boolean;
  }) {
    const db = getDb();
    const [tenant] = await db
      .update(tenants)
      .set({
        defaultLocale: input.defaultLocale,
        timezone: input.timezone,
        bookingHorizonDays: input.bookingHorizonDays,
        bookingMinAdvanceMinutes: input.bookingMinAdvanceMinutes,
        bookingBufferMinutes: input.bookingBufferMinutes,
        addressCountry: input.addressCountry,
        addressCity: input.addressCity,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        addressPostalCode: input.addressPostalCode,
        parkingAvailable: input.parkingAvailable,
        parkingNote: input.parkingNote,
        businessHoursNote: input.businessHoursNote,
        adminNotificationEmail: input.adminNotificationEmail,
        adminNotificationTelegramChatId: input.adminNotificationTelegramChatId,
        adminNotificationWhatsappE164: input.adminNotificationWhatsappE164,
        desiredWhatsappBotE164: input.desiredWhatsappBotE164,
        operatorWhatsappE164: input.operatorWhatsappE164,
        openaiEnabled: input.openaiEnabled,
        openaiModel: input.openaiModel,
        humanHandoffEnabled: input.humanHandoffEnabled,
        updatedAt: new Date()
      })
      .where(eq(tenants.id, input.tenantId))
      .returning();

    return tenant ?? null;
  }

  async updateSlug(input: { tenantId: string; slug: string }) {
    const db = getDb();
    const [tenant] = await db
      .update(tenants)
      .set({
        slug: input.slug,
        updatedAt: new Date()
      })
      .where(eq(tenants.id, input.tenantId))
      .returning();
    return tenant ?? null;
  }
}
