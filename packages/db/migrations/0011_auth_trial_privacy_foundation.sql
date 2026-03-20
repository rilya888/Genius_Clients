CREATE TABLE IF NOT EXISTS tenant_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type VARCHAR(64) NOT NULL,
  consent_version VARCHAR(64) NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip VARCHAR(64),
  user_agent VARCHAR(512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_consents_tenant_type
  ON tenant_consents(tenant_id, consent_type, accepted_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_consents_user
  ON tenant_consents(user_id, accepted_at DESC);

INSERT INTO subscription_plans (code, name, price_cents, currency, billing_period, sort_order, is_recommended, is_active)
VALUES ('business', 'Business', 39900, 'EUR', 'month', 35, FALSE, TRUE)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  price_cents = EXCLUDED.price_cents,
  currency = EXCLUDED.currency,
  billing_period = EXCLUDED.billing_period,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE,
  updated_at = NOW();

WITH business AS (
  SELECT id FROM subscription_plans WHERE code = 'business'
)
INSERT INTO subscription_plan_features (plan_id, feature_key, feature_type, value_json)
SELECT id, 'max_salons', 'number', '1'::jsonb FROM business
UNION ALL SELECT id, 'max_staff', 'number', '20'::jsonb FROM business
UNION ALL SELECT id, 'max_bookings_per_month', 'number', '5000'::jsonb FROM business
UNION ALL SELECT id, 'whatsapp_admin_handoff', 'boolean', 'true'::jsonb FROM business
UNION ALL SELECT id, 'whatsapp_admin_confirmation', 'boolean', 'true'::jsonb FROM business
ON CONFLICT (plan_id, feature_key) DO UPDATE
SET
  feature_type = EXCLUDED.feature_type,
  value_json = EXCLUDED.value_json,
  updated_at = NOW();
