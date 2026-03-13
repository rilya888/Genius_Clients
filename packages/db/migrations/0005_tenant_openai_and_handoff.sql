ALTER TABLE tenants
  ADD COLUMN admin_notification_whatsapp_e164 VARCHAR(32),
  ADD COLUMN openai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN openai_model VARCHAR(80) NOT NULL DEFAULT 'gpt-5-mini',
  ADD COLUMN human_handoff_enabled BOOLEAN NOT NULL DEFAULT TRUE;
