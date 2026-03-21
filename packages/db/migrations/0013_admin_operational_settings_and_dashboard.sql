ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS address_country VARCHAR(80),
  ADD COLUMN IF NOT EXISTS address_city VARCHAR(120),
  ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255),
  ADD COLUMN IF NOT EXISTS address_line2 VARCHAR(255),
  ADD COLUMN IF NOT EXISTS address_postal_code VARCHAR(32),
  ADD COLUMN IF NOT EXISTS parking_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS parking_note VARCHAR(255),
  ADD COLUMN IF NOT EXISTS business_hours_note VARCHAR(255);

UPDATE tenants
SET
  address_country = COALESCE(address_country, ''),
  address_city = COALESCE(address_city, ''),
  address_line1 = COALESCE(address_line1, ''),
  address_postal_code = COALESCE(address_postal_code, '')
WHERE
  address_country IS NULL
  OR address_city IS NULL
  OR address_line1 IS NULL
  OR address_postal_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_master_services_tenant_service
  ON master_services(tenant_id, service_id);

CREATE INDEX IF NOT EXISTS idx_bookings_tenant_status_start
  ON bookings(tenant_id, status, start_at);
