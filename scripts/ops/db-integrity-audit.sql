-- Key relational sanity checks for MVP booking flow.
-- Run with psql against production or staging before release sign-off.

\echo '== Row counts =='
SELECT 'tenants' AS table_name, COUNT(*)::bigint AS row_count FROM tenants
UNION ALL SELECT 'users', COUNT(*)::bigint FROM users
UNION ALL SELECT 'bookings', COUNT(*)::bigint FROM bookings
UNION ALL SELECT 'notification_deliveries', COUNT(*)::bigint FROM notification_deliveries
UNION ALL SELECT 'whatsapp_contact_windows', COUNT(*)::bigint FROM whatsapp_contact_windows
ORDER BY table_name;

\echo '== Potential booking integrity issues =='
SELECT COUNT(*)::bigint AS bookings_with_missing_tenant
FROM bookings b
LEFT JOIN tenants t ON t.id = b.tenant_id
WHERE t.id IS NULL;

SELECT COUNT(*)::bigint AS bookings_with_missing_service
FROM bookings b
LEFT JOIN services s ON s.id = b.service_id
WHERE s.id IS NULL;

SELECT COUNT(*)::bigint AS bookings_with_missing_master
FROM bookings b
LEFT JOIN masters m ON m.id = b.master_id
WHERE m.id IS NULL;

\echo '== Duplicate WhatsApp contact windows (should be 0 rows) =='
SELECT tenant_id, sender_phone_number_id, recipient_e164, COUNT(*)::bigint AS duplicates
FROM whatsapp_contact_windows
GROUP BY tenant_id, sender_phone_number_id, recipient_e164
HAVING COUNT(*) > 1;

\echo '== Latest migrations table =='
SELECT
  CASE
    WHEN to_regclass('public.__drizzle_migrations') IS NOT NULL THEN '__drizzle_migrations'
    WHEN to_regclass('public.drizzle_migrations') IS NOT NULL THEN 'drizzle_migrations'
    ELSE 'missing'
  END AS migrations_table_status;
