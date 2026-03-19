CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency VARCHAR(8) NOT NULL DEFAULT 'EUR',
  billing_period VARCHAR(16) NOT NULL DEFAULT 'month',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_recommended BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_subscription_plans_billing_period CHECK (billing_period IN ('month', 'year'))
);

CREATE TABLE IF NOT EXISTS subscription_plan_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  feature_key VARCHAR(120) NOT NULL,
  feature_type VARCHAR(24) NOT NULL,
  value_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_subscription_plan_features_plan_key UNIQUE (plan_id, feature_key),
  CONSTRAINT ck_subscription_plan_features_type CHECK (feature_type IN ('boolean', 'number', 'string', 'json'))
);

CREATE TABLE IF NOT EXISTS subscription_plan_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL,
  published_at TIMESTAMPTZ,
  published_by VARCHAR(120),
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_subscription_plan_versions_status CHECK (status IN ('draft', 'published', 'archived'))
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_code VARCHAR(40) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  billing_cycle_anchor TIMESTAMPTZ,
  pending_plan_code VARCHAR(40),
  change_mode VARCHAR(24) NOT NULL DEFAULT 'next_cycle',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_tenant_subscriptions_status CHECK (status IN ('active', 'scheduled', 'expired')),
  CONSTRAINT ck_tenant_subscriptions_change_mode CHECK (change_mode IN ('next_cycle'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant_status
  ON tenant_subscriptions(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_effective
  ON tenant_subscriptions(tenant_id, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS super_admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor VARCHAR(120) NOT NULL,
  action VARCHAR(120) NOT NULL,
  entity VARCHAR(120) NOT NULL,
  entity_id VARCHAR(120) NOT NULL,
  before_json JSONB,
  after_json JSONB,
  request_id VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_super_admin_audit_log_created_at
  ON super_admin_audit_log(created_at DESC);

INSERT INTO subscription_plans (code, name, price_cents, currency, billing_period, sort_order, is_recommended)
VALUES
  ('starter', 'Starter', 5900, 'EUR', 'month', 10, FALSE),
  ('growth', 'Growth', 10900, 'EUR', 'month', 20, TRUE),
  ('pro', 'Pro', 20900, 'EUR', 'month', 30, FALSE),
  ('enterprise', 'Enterprise', 0, 'EUR', 'month', 40, FALSE)
ON CONFLICT (code) DO NOTHING;

WITH starter AS (
  SELECT id FROM subscription_plans WHERE code = 'starter'
), growth AS (
  SELECT id FROM subscription_plans WHERE code = 'growth'
), pro AS (
  SELECT id FROM subscription_plans WHERE code = 'pro'
), enterprise AS (
  SELECT id FROM subscription_plans WHERE code = 'enterprise'
)
INSERT INTO subscription_plan_features (plan_id, feature_key, feature_type, value_json)
SELECT id, 'max_salons', 'number', '1'::jsonb FROM starter
UNION ALL SELECT id, 'max_staff', 'number', '3'::jsonb FROM starter
UNION ALL SELECT id, 'max_bookings_per_month', 'number', '300'::jsonb FROM starter
UNION ALL SELECT id, 'whatsapp_admin_handoff', 'boolean', 'true'::jsonb FROM starter
UNION ALL SELECT id, 'whatsapp_admin_confirmation', 'boolean', 'true'::jsonb FROM starter
UNION ALL SELECT id, 'max_salons', 'number', '1'::jsonb FROM growth
UNION ALL SELECT id, 'max_staff', 'number', '7'::jsonb FROM growth
UNION ALL SELECT id, 'max_bookings_per_month', 'number', '1000'::jsonb FROM growth
UNION ALL SELECT id, 'whatsapp_admin_handoff', 'boolean', 'true'::jsonb FROM growth
UNION ALL SELECT id, 'whatsapp_admin_confirmation', 'boolean', 'true'::jsonb FROM growth
UNION ALL SELECT id, 'max_salons', 'number', '3'::jsonb FROM pro
UNION ALL SELECT id, 'max_bookings_per_month', 'number', '3000'::jsonb FROM pro
UNION ALL SELECT id, 'whatsapp_admin_handoff', 'boolean', 'true'::jsonb FROM pro
UNION ALL SELECT id, 'whatsapp_admin_confirmation', 'boolean', 'true'::jsonb FROM pro
UNION ALL SELECT id, 'whatsapp_admin_handoff', 'boolean', 'true'::jsonb FROM enterprise
UNION ALL SELECT id, 'whatsapp_admin_confirmation', 'boolean', 'true'::jsonb FROM enterprise
ON CONFLICT (plan_id, feature_key) DO NOTHING;
