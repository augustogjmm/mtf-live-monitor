-- The runner substitutes the migration at the explicit marker and sends
-- the whole script on one connection. Repeatable read stabilizes all results.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE mtf_status_before(payload jsonb) ON COMMIT DROP;
INSERT INTO mtf_status_before SELECT public.mtf_system_status();
-- APPLY_STATUS_MIGRATION_HERE
DO $compare$
BEGIN
  IF (SELECT payload FROM mtf_status_before) IS DISTINCT FROM public.mtf_system_status() THEN
    RAISE EXCEPTION 'Status optimization changed the public response';
  END IF;
END
$compare$;
ROLLBACK;
SELECT 'PASS' AS response_equivalence, 'ROLLED_BACK' AS test_changes;
