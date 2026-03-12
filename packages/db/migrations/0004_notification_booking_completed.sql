DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type'
      AND e.enumlabel = 'booking_completed_client'
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'booking_completed_client';
  END IF;
END $$;
