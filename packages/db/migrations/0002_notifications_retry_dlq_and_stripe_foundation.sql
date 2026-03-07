CREATE TABLE IF NOT EXISTS stripe_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(255),
  stripe_customer_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stripe_customers_stripe_customer_id UNIQUE (stripe_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_stripe_customers_tenant_user
  ON stripe_customers(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_customers_tenant_email
  ON stripe_customers(tenant_id, email);

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notification_delivery_dispatch
  ON notification_deliveries(status, next_attempt_at, created_at);
