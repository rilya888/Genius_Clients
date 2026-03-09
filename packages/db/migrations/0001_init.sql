CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('owner', 'admin');
CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled');
CREATE TYPE notification_type AS ENUM (
  'booking_created_admin',
  'booking_confirmed_client',
  'booking_reminder_24h',
  'booking_reminder_2h',
  'booking_cancelled'
);

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  default_locale VARCHAR(5) NOT NULL DEFAULT 'it',
  timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Rome',
  booking_horizon_days INTEGER NOT NULL DEFAULT 30,
  booking_min_advance_minutes INTEGER NOT NULL DEFAULT 0,
  booking_buffer_minutes INTEGER NOT NULL DEFAULT 0,
  admin_notification_email VARCHAR(255),
  admin_notification_telegram_chat_id BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tenants_slug UNIQUE (slug),
  CONSTRAINT ck_tenants_booking_horizon_days CHECK (booking_horizon_days > 0),
  CONSTRAINT ck_tenants_booking_min_advance_minutes CHECK (booking_min_advance_minutes >= 0),
  CONSTRAINT ck_tenants_booking_buffer_minutes CHECK (booking_buffer_minutes >= 0)
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'owner',
  is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  token_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_users_email UNIQUE (email)
);
CREATE INDEX idx_users_tenant_id ON users(tenant_id);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  family_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by_token_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_refresh_tokens_token_hash UNIQUE (token_hash)
);
CREATE INDEX idx_refresh_tokens_user_expires ON refresh_tokens(user_id, expires_at);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_password_reset_tokens_token_hash UNIQUE (token_hash)
);
CREATE INDEX idx_password_reset_tokens_user_expires ON password_reset_tokens(user_id, expires_at);

CREATE TABLE email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_email_verification_tokens_token_hash UNIQUE (token_hash)
);
CREATE INDEX idx_email_verification_tokens_user_expires ON email_verification_tokens(user_id, expires_at);

CREATE TABLE masters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name VARCHAR(140) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_masters_tenant_active ON masters(tenant_id, is_active);

CREATE TABLE master_translations (
  master_id UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  locale VARCHAR(5) NOT NULL,
  display_name VARCHAR(140) NOT NULL,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_master_translations PRIMARY KEY (master_id, locale)
);
CREATE INDEX idx_master_translations_locale ON master_translations(locale);

CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name VARCHAR(160) NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price_cents INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_services_duration_positive CHECK (duration_minutes > 0),
  CONSTRAINT ck_services_price_non_negative CHECK (price_cents IS NULL OR price_cents >= 0)
);
CREATE INDEX idx_services_tenant_active ON services(tenant_id, is_active);

CREATE TABLE service_translations (
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  locale VARCHAR(5) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_service_translations PRIMARY KEY (service_id, locale)
);
CREATE INDEX idx_service_translations_locale ON service_translations(locale);

CREATE TABLE master_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  master_id UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  duration_minutes_override INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_master_services_master_service UNIQUE (master_id, service_id),
  CONSTRAINT ck_master_services_duration_override CHECK (
    duration_minutes_override IS NULL OR duration_minutes_override > 0
  )
);
CREATE INDEX idx_master_services_tenant ON master_services(tenant_id);

CREATE TABLE working_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  master_id UUID REFERENCES masters(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  start_minute INTEGER NOT NULL,
  end_minute INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_working_hours_day_of_week CHECK (day_of_week >= 0 AND day_of_week <= 6),
  CONSTRAINT ck_working_hours_start_minute CHECK (start_minute >= 0 AND start_minute < 1440),
  CONSTRAINT ck_working_hours_end_minute CHECK (end_minute > 0 AND end_minute <= 1440),
  CONSTRAINT ck_working_hours_range CHECK (start_minute < end_minute)
);
CREATE INDEX idx_working_hours_tenant_day ON working_hours(tenant_id, day_of_week);
CREATE INDEX idx_working_hours_tenant_master_day ON working_hours(tenant_id, master_id, day_of_week);

CREATE TABLE schedule_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  master_id UUID REFERENCES masters(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  start_minute INTEGER,
  end_minute INTEGER,
  note VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_schedule_exceptions_minutes CHECK (
    (start_minute IS NULL AND end_minute IS NULL)
    OR (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute)
  )
);
CREATE INDEX idx_schedule_exceptions_tenant_date ON schedule_exceptions(tenant_id, date);
CREATE INDEX idx_schedule_exceptions_tenant_master_date ON schedule_exceptions(tenant_id, master_id, date);

CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  master_id UUID REFERENCES masters(id) ON DELETE RESTRICT,
  status booking_status NOT NULL DEFAULT 'pending',
  source VARCHAR(32) NOT NULL,
  client_name VARCHAR(160) NOT NULL,
  client_phone_e164 VARCHAR(32) NOT NULL,
  client_email VARCHAR(255),
  client_locale VARCHAR(5) NOT NULL DEFAULT 'it',
  client_consent_at TIMESTAMPTZ,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  reminder24h_sent_at TIMESTAMPTZ,
  reminder2h_sent_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_bookings_time_range CHECK (start_at < end_at)
);

CREATE INDEX idx_bookings_tenant_start_at ON bookings(tenant_id, start_at);
CREATE INDEX idx_bookings_tenant_master_start_at ON bookings(tenant_id, master_id, start_at);

ALTER TABLE bookings
  ADD CONSTRAINT ex_bookings_no_overlap_active
  EXCLUDE USING gist (
    tenant_id WITH =,
    master_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status IN ('pending', 'confirmed', 'completed'));

CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key VARCHAR(255) NOT NULL,
  request_hash TEXT NOT NULL,
  response_code INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_idempotency_tenant_key UNIQUE (tenant_id, key)
);
CREATE INDEX idx_idempotency_expires_at ON idempotency_keys(expires_at);

CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  provider VARCHAR(32) NOT NULL,
  provider_event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload_json JSONB NOT NULL,
  processing_status VARCHAR(32) NOT NULL DEFAULT 'received',
  error_code VARCHAR(64),
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT uq_webhook_provider_event UNIQUE (provider, provider_event_id)
);
CREATE INDEX idx_webhook_tenant_received_at ON webhook_events(tenant_id, received_at);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  entity VARCHAR(80) NOT NULL,
  entity_id UUID,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_tenant_created_at ON audit_logs(tenant_id, created_at);
CREATE INDEX idx_audit_actor_created_at ON audit_logs(actor_user_id, created_at);

CREATE TABLE notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  notification_type notification_type NOT NULL,
  channel VARCHAR(24) NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  provider_message_id VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  error_code VARCHAR(64),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_notification_delivery_idempotency UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX idx_notification_delivery_tenant_created ON notification_deliveries(tenant_id, created_at);
