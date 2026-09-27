do $$
declare v_bad bigint;
begin
  select count(*) into v_bad
  from public.mtf_signals
  where market='crypto' and strategy_version='OB-LADDER-v3.7.2' and source='FORWARD';
  if v_bad<>0 then raise exception 'v3.7.2 guard expected zero forward signals during activation, found %',v_bad; end if;

  select count(*) into v_bad
  from public.mtf_analyzer_state
  where market='crypto' and timeframe='1h' and state ? 'lastEval';
  if v_bad<>0 then raise exception 'stale causal references remain: %',v_bad; end if;

  if coalesce(public.mtf_system_status()#>>'{build,strategy_version}','') <> 'OB-LADDER-v3.7.2' then
    raise exception 'system status build mismatch';
  end if;
end $$;
