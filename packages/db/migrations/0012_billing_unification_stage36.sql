CREATE TABLE IF NOT EXISTS subscription_plan_billing_config (
  plan_code VARCHAR(40) PRIMARY KEY REFERENCES subscription_plans(code) ON DELETE CASCADE,
  stripe_product_id VARCHAR(255),
  stripe_price_id_monthly VARCHAR(255),
  is_checkout_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_plan_billing_checkout
  ON subscription_plan_billing_config(is_checkout_enabled, plan_code);

INSERT INTO subscription_plan_billing_config (
  plan_code,
  stripe_product_id,
  stripe_price_id_monthly,
  is_checkout_enabled
)
VALUES
  ('starter', NULL, NULL, TRUE),
  ('pro', NULL, NULL, TRUE),
  ('business', NULL, NULL, TRUE),
  ('enterprise', NULL, NULL, FALSE)
ON CONFLICT (plan_code) DO UPDATE
SET
  is_checkout_enabled = EXCLUDED.is_checkout_enabled,
  updated_at = NOW();

UPDATE subscription_plans
SET
  is_active = FALSE,
  is_recommended = FALSE,
  updated_at = NOW()
WHERE code = 'growth';

UPDATE tenant_subscriptions
SET
  plan_code = 'pro',
  updated_at = NOW()
WHERE plan_code = 'growth';

UPDATE tenant_subscriptions
SET
  pending_plan_code = 'pro',
  updated_at = NOW()
WHERE pending_plan_code = 'growth';

ALTER TABLE tenant_subscriptions
  DROP CONSTRAINT IF EXISTS ck_tenant_subscriptions_status;

ALTER TABLE tenant_subscriptions
  ADD CONSTRAINT ck_tenant_subscriptions_status
  CHECK (status IN ('active', 'scheduled', 'expired', 'trialing', 'past_due', 'canceled', 'incomplete'));

ALTER TABLE tenant_subscriptions
  DROP CONSTRAINT IF EXISTS ck_tenant_subscriptions_change_mode;

ALTER TABLE tenant_subscriptions
  ADD CONSTRAINT ck_tenant_subscriptions_change_mode
  CHECK (change_mode IN ('next_cycle', 'immediate_prorate', 'manual'));

ALTER TABLE tenant_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_only_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hard_locked_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_invoice_status VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_stripe_subscription
  ON tenant_subscriptions(stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_stripe_customer
  ON tenant_subscriptions(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_status_updated
  ON tenant_subscriptions(tenant_id, status, updated_at DESC);

WITH plan_ids AS (
  SELECT id, code
  FROM subscription_plans
  WHERE code IN ('starter', 'pro', 'business', 'enterprise')
),
required_features AS (
  SELECT p.id AS plan_id, p.code, feature_key, feature_type, value_json
  FROM plan_ids p
  CROSS JOIN LATERAL (
    VALUES
      ('max_salons', 'number', CASE
        WHEN p.code = 'enterprise' THEN '10'::jsonb
        ELSE '1'::jsonb
      END),
      ('max_staff', 'number', CASE
        WHEN p.code = 'starter' THEN '3'::jsonb
        WHEN p.code = 'pro' THEN '10'::jsonb
        WHEN p.code = 'business' THEN '20'::jsonb
        ELSE '100'::jsonb
      END),
      ('max_bookings_per_month', 'number', CASE
        WHEN p.code = 'starter' THEN '300'::jsonb
        WHEN p.code = 'pro' THEN '3000'::jsonb
        WHEN p.code = 'business' THEN '5000'::jsonb
        ELSE '50000'::jsonb
      END),
      ('whatsapp_admin_handoff', 'boolean', 'true'::jsonb),
      ('whatsapp_admin_confirmation', 'boolean', 'true'::jsonb)
  ) AS feature_set(feature_key, feature_type, value_json)
)
INSERT INTO subscription_plan_features (plan_id, feature_key, feature_type, value_json)
SELECT
  plan_id,
  feature_key,
  feature_type,
  value_json
FROM required_features
ON CONFLICT (plan_id, feature_key) DO UPDATE
SET
  feature_type = EXCLUDED.feature_type,
  value_json = EXCLUDED.value_json,
  updated_at = NOW();
