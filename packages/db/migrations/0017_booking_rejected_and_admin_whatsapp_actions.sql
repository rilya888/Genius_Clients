DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'booking_status' AND e.enumlabel = 'rejected'
  ) THEN
    ALTER TYPE booking_status ADD VALUE 'rejected';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type' AND e.enumlabel = 'booking_rejected_client'
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'booking_rejected_client';
  END IF;
END
$$;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
