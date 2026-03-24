ALTER TABLE tenants
  ADD COLUMN desired_whatsapp_bot_e164 VARCHAR(32),
  ADD COLUMN operator_whatsapp_e164 VARCHAR(32);
