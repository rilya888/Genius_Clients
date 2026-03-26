ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS wa_delivery_mode VARCHAR(16),
  ADD COLUMN IF NOT EXISTS wa_template_name VARCHAR(140),
  ADD COLUMN IF NOT EXISTS wa_template_lang VARCHAR(16),
  ADD COLUMN IF NOT EXISTS wa_window_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wa_window_open BOOLEAN,
  ADD COLUMN IF NOT EXISTS wa_policy_reason VARCHAR(80);

CREATE TABLE IF NOT EXISTS whatsapp_contact_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sender_phone_number_id VARCHAR(80) NOT NULL,
  recipient_e164 VARCHAR(32) NOT NULL,
  last_inbound_at TIMESTAMPTZ NOT NULL,
  last_known_locale VARCHAR(5),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_contact_window_tenant_sender_recipient
  ON whatsapp_contact_windows(tenant_id, sender_phone_number_id, recipient_e164);

CREATE INDEX IF NOT EXISTS idx_wa_contact_window_lookup
  ON whatsapp_contact_windows(tenant_id, sender_phone_number_id, recipient_e164);

CREATE INDEX IF NOT EXISTS idx_wa_contact_window_inbound
  ON whatsapp_contact_windows(last_inbound_at);

ALTER TABLE channel_endpoints_v2
  ADD COLUMN IF NOT EXISTS booking_created_admin_template_name VARCHAR(140),
  ADD COLUMN IF NOT EXISTS booking_reminder_24h_template_name VARCHAR(140),
  ADD COLUMN IF NOT EXISTS booking_reminder_2h_template_name VARCHAR(140);
