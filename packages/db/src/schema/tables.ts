import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  primaryKey,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["owner", "admin"]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "rejected",
  "no_show"
]);
export const notificationTypeEnum = pgEnum("notification_type", [
  "booking_created_admin",
  "booking_confirmed_client",
  "booking_completed_client",
  "booking_reminder_24h",
  "booking_reminder_2h",
  "booking_cancelled",
  "booking_rejected_client"
]);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    defaultLocale: varchar("default_locale", { length: 5 }).notNull().default("it"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("Europe/Rome"),
    bookingHorizonDays: integer("booking_horizon_days").notNull().default(30),
    bookingMinAdvanceMinutes: integer("booking_min_advance_minutes").notNull().default(0),
    bookingBufferMinutes: integer("booking_buffer_minutes").notNull().default(0),
    addressCountry: varchar("address_country", { length: 80 }),
    addressCity: varchar("address_city", { length: 120 }),
    addressLine1: varchar("address_line1", { length: 255 }),
    addressLine2: varchar("address_line2", { length: 255 }),
    addressPostalCode: varchar("address_postal_code", { length: 32 }),
    parkingAvailable: boolean("parking_available"),
    parkingNote: varchar("parking_note", { length: 255 }),
    businessHoursNote: varchar("business_hours_note", { length: 255 }),
    adminNotificationEmail: varchar("admin_notification_email", { length: 255 }),
    adminNotificationTelegramChatId: bigint("admin_notification_telegram_chat_id", {
      mode: "number"
    }),
    adminNotificationWhatsappE164: varchar("admin_notification_whatsapp_e164", { length: 32 }),
    desiredWhatsappBotE164: varchar("desired_whatsapp_bot_e164", { length: 32 }),
    operatorWhatsappE164: varchar("operator_whatsapp_e164", { length: 32 }),
    openaiEnabled: boolean("openai_enabled").notNull().default(true),
    openaiModel: varchar("openai_model", { length: 80 }).notNull().default("gpt-5-mini"),
    humanHandoffEnabled: boolean("human_handoff_enabled").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("uq_tenants_slug").on(t.slug),
    check("ck_tenants_booking_horizon_days", sql`${t.bookingHorizonDays} > 0`),
    check(
      "ck_tenants_booking_min_advance_minutes",
      sql`${t.bookingMinAdvanceMinutes} >= 0`
    ),
    check("ck_tenants_booking_buffer_minutes", sql`${t.bookingBufferMinutes} >= 0`)
  ]
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("owner"),
    isEmailVerified: boolean("is_email_verified").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    tokenVersion: integer("token_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("uq_users_email").on(t.email),
    index("idx_users_tenant_id").on(t.tenantId)
  ]
);

export const tenantConsents = pgTable(
  "tenant_consents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    consentType: varchar("consent_type", { length: 64 }).notNull(),
    consentVersion: varchar("consent_version", { length: 64 }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("idx_tenant_consents_tenant_type").on(t.tenantId, t.consentType, t.acceptedAt),
    index("idx_tenant_consents_user").on(t.userId, t.acceptedAt)
  ]
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    familyId: uuid("family_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedByTokenId: uuid("replaced_by_token_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("uq_refresh_tokens_token_hash").on(t.tokenHash),
    index("idx_refresh_tokens_user_expires").on(t.userId, t.expiresAt),
    index("idx_refresh_tokens_family").on(t.familyId)
  ]
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("uq_password_reset_tokens_token_hash").on(t.tokenHash),
    index("idx_password_reset_tokens_user_expires").on(t.userId, t.expiresAt)
  ]
);

export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("uq_email_verification_tokens_token_hash").on(t.tokenHash),
    index("idx_email_verification_tokens_user_expires").on(t.userId, t.expiresAt)
  ]
);

export const masters = pgTable(
  "masters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 140 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("idx_masters_tenant_active").on(t.tenantId, t.isActive)]
);

export const masterTranslations = pgTable(
  "master_translations",
  {
    masterId: uuid("master_id")
      .notNull()
      .references(() => masters.id, { onDelete: "cascade" }),
    locale: varchar("locale", { length: 5 }).notNull(),
    displayName: varchar("display_name", { length: 140 }).notNull(),
    bio: text("bio"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    primaryKey({ columns: [t.masterId, t.locale], name: "pk_master_translations" }),
    index("idx_master_translations_locale").on(t.locale)
  ]
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    priceCents: integer("price_cents"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("idx_services_tenant_active").on(t.tenantId, t.isActive),
    check("ck_services_duration_positive", sql`${t.durationMinutes} > 0`),
    check("ck_services_price_non_negative", sql`${t.priceCents} is null or ${t.priceCents} >= 0`)
  ]
);

export const serviceTranslations = pgTable(
  "service_translations",
  {
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    locale: varchar("locale", { length: 5 }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    primaryKey({ columns: [t.serviceId, t.locale], name: "pk_service_translations" }),
    index("idx_service_translations_locale").on(t.locale)
  ]
);

export const masterServices = pgTable(
  "master_services",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    masterId: uuid("master_id")
      .notNull()
      .references(() => masters.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    durationMinutesOverride: integer("duration_minutes_override"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("uq_master_services_master_service").on(t.masterId, t.serviceId),
    index("idx_master_services_tenant").on(t.tenantId),
    check(
      "ck_master_services_duration_override",
      sql`${t.durationMinutesOverride} is null or ${t.durationMinutesOverride} > 0`
    )
  ]
);

export const workingHours = pgTable(
  "working_hours",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    masterId: uuid("master_id").references(() => masters.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("idx_working_hours_tenant_day").on(t.tenantId, t.dayOfWeek),
    index("idx_working_hours_tenant_master_day").on(t.tenantId, t.masterId, t.dayOfWeek),
    check("ck_working_hours_day_of_week", sql`${t.dayOfWeek} >= 0 and ${t.dayOfWeek} <= 6`),
    check("ck_working_hours_start_minute", sql`${t.startMinute} >= 0 and ${t.startMinute} < 1440`),
    check("ck_working_hours_end_minute", sql`${t.endMinute} > 0 and ${t.endMinute} <= 1440`),
    check("ck_working_hours_range", sql`${t.startMinute} < ${t.endMinute}`)
  ]
);

export const scheduleExceptions = pgTable(
  "schedule_exceptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    masterId: uuid("master_id").references(() => masters.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    isClosed: boolean("is_closed").notNull().default(false),
    startMinute: integer("start_minute"),
    endMinute: integer("end_minute"),
    note: varchar("note", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("idx_schedule_exceptions_tenant_date").on(t.tenantId, t.date),
    index("idx_schedule_exceptions_tenant_master_date").on(t.tenantId, t.masterId, t.date),
    check(
      "ck_schedule_exceptions_minutes",
      sql`(${t.startMinute} is null and ${t.endMinute} is null) or (${t.startMinute} >= 0 and ${t.endMinute} <= 1440 and ${t.startMinute} < ${t.endMinute})`
    )
  ]
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    masterId: uuid("master_id").references(() => masters.id, { onDelete: "restrict" }),
    status: bookingStatusEnum("status").notNull().default("pending"),
    source: varchar("source", { length: 32 }).notNull(),
    clientName: varchar("client_name", { length: 160 }).notNull(),
    clientPhoneE164: varchar("client_phone_e164", { length: 32 }).notNull(),
    clientEmail: varchar("client_email", { length: 255 }),
    clientLocale: varchar("client_locale", { length: 5 }).notNull().default("it"),
    clientConsentAt: timestamp("client_consent_at", { withTimezone: true }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    reminder24hSentAt: timestamp("reminder24h_sent_at", { withTimezone: true }),
    reminder2hSentAt: timestamp("reminder2h_sent_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    cancellationReasonCategory: varchar("cancellation_reason_category", { length: 64 }),
    rejectionReason: text("rejection_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedAmountMinor: integer("completed_amount_minor"),
    completedCurrency: varchar("completed_currency", { length: 8 }),
    completedPaymentMethod: varchar("completed_payment_method", { length: 32 }),
    completedPaymentNote: text("completed_payment_note"),
    completedByUserId: uuid("completed_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("idx_bookings_tenant_start_at").on(t.tenantId, t.startAt),
    index("idx_bookings_tenant_master_start_at").on(t.tenantId, t.masterId, t.startAt),
    check("ck_bookings_time_range", sql`${t.startAt} < ${t.endAt}`)
  ]
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 255 }).notNull(),
    requestHash: text("request_hash").notNull(),
    responseCode: integer("response_code").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
  },
  (t) => [
    unique("uq_idempotency_tenant_key").on(t.tenantId, t.key),
    index("idx_idempotency_expires_at").on(t.expiresAt)
  ]
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    processingStatus: varchar("processing_status", { length: 32 }).notNull().default("received"),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true })
  },
  (t) => [
    unique("uq_webhook_provider_event").on(t.provider, t.providerEventId),
    index("idx_webhook_tenant_received_at").on(t.tenantId, t.receivedAt)
  ]
);

export const stripeCustomers = pgTable(
  "stripe_customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: varchar("email", { length: 255 }),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("uq_stripe_customers_stripe_customer_id").on(t.stripeCustomerId),
    index("idx_stripe_customers_tenant_user").on(t.tenantId, t.userId),
    index("idx_stripe_customers_tenant_email").on(t.tenantId, t.email)
  ]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 80 }).notNull(),
    entity: varchar("entity", { length: 80 }).notNull(),
    entityId: uuid("entity_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("idx_audit_tenant_created_at").on(t.tenantId, t.createdAt),
    index("idx_audit_actor_created_at").on(t.actorUserId, t.createdAt)
  ]
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    notificationType: notificationTypeEnum("notification_type").notNull(),
    channel: varchar("channel", { length: 24 }).notNull(),
    recipient: varchar("recipient", { length: 255 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    status: varchar("status", { length: 32 }).notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    waDeliveryMode: varchar("wa_delivery_mode", { length: 16 }),
    waTemplateName: varchar("wa_template_name", { length: 140 }),
    waTemplateLang: varchar("wa_template_lang", { length: 16 }),
    waWindowCheckedAt: timestamp("wa_window_checked_at", { withTimezone: true }),
    waWindowOpen: boolean("wa_window_open"),
    waPolicyReason: varchar("wa_policy_reason", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("uq_notification_delivery_idempotency").on(t.tenantId, t.idempotencyKey),
    index("idx_notification_delivery_tenant_created").on(t.tenantId, t.createdAt),
    index("idx_notification_delivery_dispatch").on(t.status, t.nextAttemptAt, t.createdAt)
  ]
);

export const whatsappContactWindows = pgTable(
  "whatsapp_contact_windows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    senderPhoneNumberId: varchar("sender_phone_number_id", { length: 80 }).notNull(),
    recipientE164: varchar("recipient_e164", { length: 32 }).notNull(),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }).notNull(),
    lastKnownLocale: varchar("last_known_locale", { length: 5 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("uq_wa_contact_window_tenant_sender_recipient").on(
      t.tenantId,
      t.senderPhoneNumberId,
      t.recipientE164
    ),
    index("idx_wa_contact_window_lookup").on(t.tenantId, t.senderPhoneNumberId, t.recipientE164),
    index("idx_wa_contact_window_inbound").on(t.lastInboundAt)
  ]
);

export const channelEndpointsV2 = pgTable(
  "channel_endpoints_v2",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: varchar("provider", { length: 32 }).notNull(),
    externalEndpointId: varchar("external_endpoint_id", { length: 80 }).notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    salonId: varchar("salon_id", { length: 80 }).notNull(),
    environment: varchar("environment", { length: 16 }).notNull().default("production"),
    bindingStatus: varchar("binding_status", { length: 32 }).notNull().default("draft"),
    displayName: varchar("display_name", { length: 140 }),
    displayPhoneNumber: varchar("display_phone_number", { length: 32 }),
    e164: varchar("e164", { length: 32 }),
    verifiedName: varchar("verified_name", { length: 140 }),
    wabaId: varchar("waba_id", { length: 64 }),
    businessId: varchar("business_id", { length: 64 }),
    tokenSource: varchar("token_source", { length: 24 }).notNull().default("unknown"),
    templateStatus: varchar("template_status", { length: 24 }).notNull().default("unknown"),
    bookingCreatedAdminTemplateName: varchar("booking_created_admin_template_name", {
      length: 140
    }),
    bookingReminder24hTemplateName: varchar("booking_reminder_24h_template_name", {
      length: 140
    }),
    bookingReminder2hTemplateName: varchar("booking_reminder_2h_template_name", {
      length: 140
    }),
    profileStatus: varchar("profile_status", { length: 24 }).notNull().default("unknown"),
    qualityRating: varchar("quality_rating", { length: 32 }),
    metaStatus: varchar("meta_status", { length: 32 }),
    codeVerificationStatus: varchar("code_verification_status", { length: 32 }),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 120 }),
    updatedBy: varchar("updated_by", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("uq_channel_endpoints_v2_provider_external").on(t.provider, t.externalEndpointId),
    index("idx_channel_endpoints_v2_tenant_provider").on(t.tenantId, t.provider, t.isActive),
    index("idx_channel_endpoints_v2_provider_status").on(t.provider, t.bindingStatus, t.isActive),
    check(
      "ck_channel_endpoints_v2_environment",
      sql`${t.environment} in ('sandbox', 'production')`
    ),
    check(
      "ck_channel_endpoints_v2_binding_status",
      sql`${t.bindingStatus} in ('draft', 'pending_verification', 'connected', 'disabled')`
    ),
    check(
      "ck_channel_endpoints_v2_token_source",
      sql`${t.tokenSource} in ('unknown', 'map', 'fallback')`
    ),
    check(
      "ck_channel_endpoints_v2_template_status",
      sql`${t.templateStatus} in ('unknown', 'not_ready', 'ready')`
    ),
    check(
      "ck_channel_endpoints_v2_profile_status",
      sql`${t.profileStatus} in ('unknown', 'incomplete', 'ready')`
    )
  ]
);

export const channelEndpointEvents = pgTable(
  "channel_endpoint_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => channelEndpointsV2.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 80 }).notNull(),
    actor: varchar("actor", { length: 120 }),
    payloadJson: jsonb("payload_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("idx_channel_endpoint_events_endpoint_created").on(t.endpointId, t.createdAt)]
);

export const whatsappNumberProvisioningJobs = pgTable(
  "whatsapp_number_provisioning_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botNumberE164: varchar("bot_number_e164", { length: 32 }).notNull(),
    operatorNumberE164: varchar("operator_number_e164", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    step: varchar("step", { length: 32 }).notNull().default("validating"),
    jobKey: varchar("job_key", { length: 120 }).notNull(),
    metaPayloadJson: jsonb("meta_payload_json"),
    errorCode: varchar("error_code", { length: 80 }),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 120 }),
    updatedBy: varchar("updated_by", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("uq_whatsapp_number_provisioning_jobs_job_key").on(t.jobKey),
    index("idx_whatsapp_number_provisioning_jobs_tenant_created").on(t.tenantId, t.createdAt),
    index("idx_whatsapp_number_provisioning_jobs_tenant_status").on(t.tenantId, t.status, t.updatedAt),
    check(
      "ck_whatsapp_number_provisioning_jobs_status",
      sql`${t.status} in ('draft', 'running', 'otp_required', 'ready', 'failed_retryable', 'failed_final', 'rolled_back')`
    ),
    check(
      "ck_whatsapp_number_provisioning_jobs_step",
      sql`${t.step} in ('validating', 'meta_prepare', 'otp_request', 'otp_verify', 'routing_update', 'healthcheck', 'done')`
    ),
    check("ck_whatsapp_number_provisioning_jobs_attempts_non_negative", sql`${t.attempts} >= 0`)
  ]
);

export const whatsappTenantBindings = pgTable(
  "whatsapp_tenant_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botNumberE164: varchar("bot_number_e164", { length: 32 }).notNull(),
    operatorNumberE164: varchar("operator_number_e164", { length: 32 }).notNull(),
    phoneNumberId: varchar("phone_number_id", { length: 80 }).notNull(),
    wabaId: varchar("waba_id", { length: 80 }),
    businessId: varchar("business_id", { length: 80 }),
    endpointId: uuid("endpoint_id").references(() => channelEndpointsV2.id, { onDelete: "set null" }),
    bindingVersion: integer("binding_version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 120 }),
    updatedBy: varchar("updated_by", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    unique("uq_whatsapp_tenant_bindings_phone_number_id").on(t.phoneNumberId),
    index("idx_whatsapp_tenant_bindings_tenant_version").on(t.tenantId, t.bindingVersion),
    index("idx_whatsapp_tenant_bindings_tenant_active").on(t.tenantId, t.isActive, t.updatedAt),
    check("ck_whatsapp_tenant_bindings_binding_version_positive", sql`${t.bindingVersion} > 0`)
  ]
);

export const whatsappOtpSessions = pgTable(
  "whatsapp_otp_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => whatsappNumberProvisioningJobs.id, { onDelete: "cascade" }),
    verificationMethod: varchar("verification_method", { length: 16 }).notNull().default("sms"),
    maskedTarget: varchar("masked_target", { length: 64 }),
    state: varchar("state", { length: 24 }).notNull().default("created"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("idx_whatsapp_otp_sessions_job_created").on(t.jobId, t.createdAt),
    check("ck_whatsapp_otp_sessions_verification_method", sql`${t.verificationMethod} in ('sms', 'voice')`),
    check("ck_whatsapp_otp_sessions_state", sql`${t.state} in ('created', 'requested', 'verified', 'expired', 'failed')`),
    check("ck_whatsapp_otp_sessions_attempts_non_negative", sql`${t.attempts} >= 0`),
    check("ck_whatsapp_otp_sessions_max_attempts_positive", sql`${t.maxAttempts} > 0`)
  ]
);
