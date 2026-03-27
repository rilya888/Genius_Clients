CREATE INDEX IF NOT EXISTS idx_bookings_tenant_completed_at
  ON bookings (tenant_id, completed_at DESC)
  WHERE status = 'completed' AND completed_at IS NOT NULL;
