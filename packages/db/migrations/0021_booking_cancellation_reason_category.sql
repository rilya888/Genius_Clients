ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cancellation_reason_category VARCHAR(64);
