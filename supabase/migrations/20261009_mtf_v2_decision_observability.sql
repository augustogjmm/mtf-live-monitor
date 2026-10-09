-- Restore v2 decision observability without mixing the previous strategy epoch.
DO $mtf$
DECLARE v text;
BEGIN
 SELECT pg_get_functiondef('public.mtf_audit_status()'::regprocedure) INTO v;
 v := replace(v, 'OB-LADDER-v3.7.3', 'MACD-OB-v2.0');
 v := replace(v, 'OB-LADDER-v3.6', 'CEDEAR-MACD-OB-v2.0');
 EXECUTE v;
 SELECT pg_get_functiondef('public.mtf_latest_decisions(text)'::regprocedure) INTO v;
 v := replace(v, 'strategy_version=''OB-LADDER-v3.5''', 'strategy_version in (''MACD-OB-v2.0'',''CEDEAR-MACD-OB-v2.0'',''ADR-OB-v1.0'')');
 EXECUTE v;
END
$mtf$;
