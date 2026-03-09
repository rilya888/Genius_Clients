ALTER TABLE tenants
  ALTER COLUMN booking_min_advance_minutes SET DEFAULT 0;

UPDATE tenants
SET booking_min_advance_minutes = 0
WHERE booking_min_advance_minutes = 60;
