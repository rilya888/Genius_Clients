CREATE TABLE IF NOT EXISTS system_runtime_settings (
  setting_key VARCHAR(120) PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_by VARCHAR(120),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_runtime_settings_updated_at
  ON system_runtime_settings(updated_at DESC);
