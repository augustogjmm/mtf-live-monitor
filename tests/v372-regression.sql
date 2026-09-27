-- v3.7.2 post-deploy regression checks.
do $$
declare
  v_epoch timestamptz;
  v_bad bigint;
  v_rule jsonb;
begin
  select started_at into v_epoch from public.mtf_stats_epochs where active=true order by started_at desc limit 1;
  if v_epoch is null then raise exception 'v3.7.2: no active stats epoch'; end if;

  select rules into v_rule from public.mtf_strategy_registry where version='OB-LADDER-v3.7.2';
  if v_rule is null then raise exception 'v3.7.2: strategy registry missing'; end if;
  if coalesce((v_rule->>'minimum_rr')::numeric,0) <> 1.8 then raise exception 'v3.7.2: minimum RR mismatch'; end if;
  if coalesce(v_rule->>'causality','')='' then raise exception 'v3.7.2: causality rule missing'; end if;
  if coalesce(v_rule->>'post_entry_monitoring','')='' then raise exception 'v3.7.2: first-minute monitoring rule missing'; end if;
  if coalesce(v_rule->>'ladder_selection','')='' then raise exception 'v3.7.2: ladder selection rule missing'; end if;

  select count(*) into v_bad
  from public.mtf_signals
  where market='crypto'
    and strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7','OB-LADDER-v3.7.1')
    and source in ('FORWARD','MIGRATED_STRICT');
  if v_bad<>0 then raise exception 'v3.7.2: prior crypto rows remain operational: %',v_bad; end if;

  select count(*) into v_bad
  from public.mtf_signals
  where market='crypto' and strategy_version='OB-LADDER-v3.7.2' and source='FORWARD'
    and (
      coalesce(context->>'trigger_basis','')<>'closed_1h_rejection_from_active_ob'
      or coalesce(context->>'ladder_basis','')<>'pre_confirmation_detector_state'
      or coalesce((context->>'rr_min')::numeric,0)<1.8
      or coalesce(context->>'initial_stop','')=''
    );
  if v_bad<>0 then raise exception 'v3.7.2: invalid causal crypto signal metadata: %',v_bad; end if;

  select count(*) into v_bad
  from public.mtf_alert_events
  where market='crypto'
    and strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7')
    and status in ('PENDING','SENDING');
  if v_bad<>0 then raise exception 'v3.7.2: stale crypto alerts still deliverable: %',v_bad; end if;

  if (public.mtf_stats_snapshot()->>'collection_label') not like 'v3.7.2 crypto%' then
    raise exception 'v3.7.2: stats snapshot not on causal cohort';
  end if;
end $$;

select public.mtf_stats_snapshot() as stats_snapshot;
select public.mtf_audit_status() as audit_status;
select public.mtf_system_status() as system_status;
