CREATE TABLE IF NOT EXISTS whatsapp_number_provisioning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bot_number_e164 VARCHAR(32) NOT NULL,
  operator_number_e164 VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  step VARCHAR(32) NOT NULL DEFAULT 'validating',
  job_key VARCHAR(120) NOT NULL,
  meta_payload_json JSONB,
  error_code VARCHAR(80),
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  created_by VARCHAR(120),
  updated_by VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_whatsapp_number_provisioning_jobs_job_key UNIQUE(job_key),
  CONSTRAINT ck_whatsapp_number_provisioning_jobs_status
    CHECK (status IN ('draft', 'running', 'otp_required', 'ready', 'failed_retryable', 'failed_final', 'rolled_back')),
  CONSTRAINT ck_whatsapp_number_provisioning_jobs_step
    CHECK (step IN ('validating', 'meta_prepare', 'otp_request', 'otp_verify', 'routing_update', 'healthcheck', 'done')),
  CONSTRAINT ck_whatsapp_number_provisioning_jobs_attempts_non_negative
    CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_number_provisioning_jobs_tenant_created
  ON whatsapp_number_provisioning_jobs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_number_provisioning_jobs_tenant_status
  ON whatsapp_number_provisioning_jobs(tenant_id, status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_number_provisioning_jobs_tenant_active
  ON whatsapp_number_provisioning_jobs(tenant_id)
  WHERE status IN ('draft', 'running', 'otp_required', 'failed_retryable');

CREATE TABLE IF NOT EXISTS whatsapp_tenant_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bot_number_e164 VARCHAR(32) NOT NULL,
  operator_number_e164 VARCHAR(32) NOT NULL,
  phone_number_id VARCHAR(80) NOT NULL,
  waba_id VARCHAR(80),
  business_id VARCHAR(80),
  endpoint_id UUID REFERENCES channel_endpoints_v2(id) ON DELETE SET NULL,
  binding_version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_by VARCHAR(120),
  updated_by VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_whatsapp_tenant_bindings_phone_number_id UNIQUE(phone_number_id),
  CONSTRAINT ck_whatsapp_tenant_bindings_binding_version_positive CHECK (binding_version > 0)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_tenant_bindings_tenant_version
  ON whatsapp_tenant_bindings(tenant_id, binding_version DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_tenant_bindings_tenant_active
  ON whatsapp_tenant_bindings(tenant_id, is_active, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_tenant_bindings_tenant_active
  ON whatsapp_tenant_bindings(tenant_id)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS whatsapp_otp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES whatsapp_number_provisioning_jobs(id) ON DELETE CASCADE,
  verification_method VARCHAR(16) NOT NULL DEFAULT 'sms',
  masked_target VARCHAR(64),
  state VARCHAR(24) NOT NULL DEFAULT 'created',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  otp_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_whatsapp_otp_sessions_verification_method CHECK (verification_method IN ('sms', 'voice')),
  CONSTRAINT ck_whatsapp_otp_sessions_state CHECK (state IN ('created', 'requested', 'verified', 'expired', 'failed')),
  CONSTRAINT ck_whatsapp_otp_sessions_attempts_non_negative CHECK (attempts >= 0),
  CONSTRAINT ck_whatsapp_otp_sessions_max_attempts_positive CHECK (max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_otp_sessions_job_created
  ON whatsapp_otp_sessions(job_id, created_at DESC);

WITH endpoint_seed AS (
  SELECT
    ce.tenant_id,
    COALESCE(ce.e164, t.desired_whatsapp_bot_e164) AS bot_number_e164,
    COALESCE(t.operator_whatsapp_e164, t.admin_notification_whatsapp_e164, '+00000000000') AS operator_number_e164,
    ce.external_endpoint_id AS phone_number_id,
    ce.waba_id,
    ce.business_id,
    ce.id AS endpoint_id,
    ce.connected_at,
    ce.updated_at,
    row_number() OVER (PARTITION BY ce.tenant_id ORDER BY ce.updated_at DESC, ce.created_at DESC) AS rn
  FROM channel_endpoints_v2 ce
  JOIN tenants t ON t.id = ce.tenant_id
  WHERE ce.provider = 'whatsapp'
    AND ce.is_active = TRUE
    AND ce.binding_status = 'connected'
    AND ce.external_endpoint_id IS NOT NULL
)
INSERT INTO whatsapp_tenant_bindings (
  tenant_id,
  bot_number_e164,
  operator_number_e164,
  phone_number_id,
  waba_id,
  business_id,
  endpoint_id,
  binding_version,
  is_active,
  verified_at,
  created_by,
  updated_by,
  created_at,
  updated_at
)
SELECT
  tenant_id,
  bot_number_e164,
  operator_number_e164,
  phone_number_id,
  waba_id,
  business_id,
  endpoint_id,
  1,
  rn = 1,
  connected_at,
  'migration_0022',
  'migration_0022',
  NOW(),
  updated_at
FROM endpoint_seed
WHERE bot_number_e164 IS NOT NULL
  AND bot_number_e164 <> ''
  AND phone_number_id IS NOT NULL
  AND phone_number_id <> ''
ON CONFLICT (phone_number_id) DO NOTHING;
