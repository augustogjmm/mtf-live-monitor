-- Preserve a full day of diagnostics and all signal/configuration data.
DO $migration$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('public.mtf_retention_cleanup()'::regprocedure);
  IF strpos(definition, 'evaluated_at < now() - interval ''24 hours''') > 0 THEN
    RETURN;
  END IF;
  IF strpos(definition, 'evaluated_at < now() - interval ''36 hours''') = 0 THEN
    RAISE EXCEPTION 'Unexpected retention definition; no changes applied';
  END IF;
  EXECUTE replace(definition,
    'evaluated_at < now() - interval ''36 hours''',
    'evaluated_at < now() - interval ''24 hours''');
END;
$migration$;
