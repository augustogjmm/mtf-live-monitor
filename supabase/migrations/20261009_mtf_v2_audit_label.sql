DO $mtf$
DECLARE v text;
BEGIN
 SELECT pg_get_functiondef('public.mtf_audit_status()'::regprocedure) INTO v;
 v := replace(v,'MACD-OB-v2.0 + v3.6 CEDEAR + ADR-OB-v1.0','MACD-OB-v2.0 + CEDEAR-MACD-OB-v2.0 + ADR-OB-v1.0');
 EXECUTE v;
END
$mtf$;