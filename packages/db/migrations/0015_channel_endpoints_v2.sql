CREATE TABLE IF NOT EXISTS channel_endpoints_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(32) NOT NULL,
  external_endpoint_id VARCHAR(80) NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  salon_id VARCHAR(80) NOT NULL,
  environment VARCHAR(16) NOT NULL DEFAULT 'production',
  binding_status VARCHAR(32) NOT NULL DEFAULT 'draft',
  display_name VARCHAR(140),
  display_phone_number VARCHAR(32),
  e164 VARCHAR(32),
  verified_name VARCHAR(140),
  waba_id VARCHAR(64),
  business_id VARCHAR(64),
  token_source VARCHAR(24) NOT NULL DEFAULT 'unknown',
  template_status VARCHAR(24) NOT NULL DEFAULT 'unknown',
  profile_status VARCHAR(24) NOT NULL DEFAULT 'unknown',
  quality_rating VARCHAR(32),
  meta_status VARCHAR(32),
  code_verification_status VARCHAR(32),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  connected_at TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  created_by VARCHAR(120),
  updated_by VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_channel_endpoints_v2_provider_external UNIQUE (provider, external_endpoint_id),
  CONSTRAINT ck_channel_endpoints_v2_environment CHECK (environment IN ('sandbox', 'production')),
  CONSTRAINT ck_channel_endpoints_v2_binding_status CHECK (binding_status IN ('draft', 'pending_verification', 'connected', 'disabled')),
  CONSTRAINT ck_channel_endpoints_v2_token_source CHECK (token_source IN ('unknown', 'map', 'fallback')),
  CONSTRAINT ck_channel_endpoints_v2_template_status CHECK (template_status IN ('unknown', 'not_ready', 'ready')),
  CONSTRAINT ck_channel_endpoints_v2_profile_status CHECK (profile_status IN ('unknown', 'incomplete', 'ready'))
);

CREATE INDEX IF NOT EXISTS idx_channel_endpoints_v2_tenant_provider
  ON channel_endpoints_v2 (tenant_id, provider, is_active);

CREATE INDEX IF NOT EXISTS idx_channel_endpoints_v2_provider_status
  ON channel_endpoints_v2 (provider, binding_status, is_active);

CREATE TABLE IF NOT EXISTS channel_endpoint_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES channel_endpoints_v2(id) ON DELETE CASCADE,
  action VARCHAR(80) NOT NULL,
  actor VARCHAR(120),
  payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_endpoint_events_endpoint_created
  ON channel_endpoint_events (endpoint_id, created_at);
