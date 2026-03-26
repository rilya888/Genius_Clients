DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'booking_status' AND e.enumlabel = 'no_show'
  ) THEN
    ALTER TYPE booking_status ADD VALUE 'no_show';
  END IF;
END
$$;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_amount_minor integer,
  ADD COLUMN IF NOT EXISTS completed_currency varchar(8),
  ADD COLUMN IF NOT EXISTS completed_payment_method varchar(32),
  ADD COLUMN IF NOT EXISTS completed_payment_note text,
  ADD COLUMN IF NOT EXISTS completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
