-- Existing open v1 positions are monitoring states, not v2 entry executions.
DO $mtf$
DECLARE v text;
BEGIN
 SELECT pg_get_functiondef('public.mtf_capture_live_decision_audit()'::regprocedure) INTO v;
 v := replace(v,
 $old$when coalesce(nullif(item->>'created','')::int,0) > 0 or v_state in ('ENTRY','OPEN') then 'ENTRY'$old$,
 $new$when coalesce(nullif(item->>'created','')::int,0) > 0 then 'ENTRY'
       when v_state in ('OPEN','ENTRY') then 'BLOCKED_OPEN'$new$);
 IF position('when v_state in (''OPEN'',''ENTRY'') then ''BLOCKED_OPEN''' in v)=0 THEN
   RAISE EXCEPTION 'Audit capture rule could not be replaced';
 END IF;
 EXECUTE v;
END
$mtf$;
UPDATE public.mtf_decision_audit AS d
SET decision='BLOCKED_OPEN',reason='legacy_v1_position_under_monitoring_not_v2_entry'
WHERE d.strategy_version='MACD-OB-v2.0' AND d.market='crypto'
  AND d.decision='ENTRY' AND d.context->>'state'='OPEN'
  AND d.evaluated_at>=(SELECT started_at FROM public.mtf_stats_epochs WHERE active=true ORDER BY started_at DESC LIMIT 1)
  AND EXISTS(SELECT 1 FROM public.mtf_signals s WHERE s.symbol=d.symbol AND s.market='crypto' AND s.strategy_version='MACD-OB-v1.0' AND s.status='OPEN')
  AND NOT EXISTS(SELECT 1 FROM public.mtf_signals s WHERE s.symbol=d.symbol AND s.market='crypto' AND s.strategy_version='MACD-OB-v2.0');
