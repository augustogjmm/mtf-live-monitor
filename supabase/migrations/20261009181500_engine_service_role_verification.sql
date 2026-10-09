-- PostgREST verifies the JWT and selects the database role before this runs.
-- Do not grant this RPC to a public or authenticated application user.
CREATE OR REPLACE FUNCTION public.mtf_engine_auth_status()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$ SELECT current_user = 'service_role' $$;
REVOKE ALL ON FUNCTION public.mtf_engine_auth_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mtf_engine_auth_status() TO service_role;
NOTIFY pgrst, 'reload schema';
