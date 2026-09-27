-- v3.7 post-deploy regression checks. Fails transaction if a critical invariant is broken.
do $$
declare
  v_epoch timestamptz;
  v_bad bigint;
  v_rule jsonb;
begin
  select started_at into v_epoch from public.mtf_stats_epochs where active=true order by started_at desc limit 1;
  if v_epoch is null then raise exception 'v3.7: no active stats epoch'; end if;

  select rules into v_rule from public.mtf_strategy_registry where version='OB-LADDER-v3.7';
  if v_rule is null then raise exception 'v3.7: strategy registry missing'; end if;
  if coalesce((v_rule->>'minimum_rr')::numeric,0) <> 1.8 then raise exception 'v3.7: minimum RR registry mismatch'; end if;

  select count(*) into v_bad
  from public.mtf_signals
  where market='crypto' and strategy_version='OB-LADDER-v3.6'
    and source in ('FORWARD','MIGRATED_STRICT');
  if v_bad<>0 then raise exception 'v3.7: legacy crypto rows remain operational: %',v_bad; end if;

  select count(*) into v_bad
  from public.mtf_signals
  where market='crypto' and strategy_version='OB-LADDER-v3.7' and source='FORWARD'
    and (
      coalesce(context->>'trigger_basis','')<>'closed_1h_rejection_from_active_ob'
      or coalesce((context->>'rr_min')::numeric,0)<1.8
      or coalesce(context->>'initial_stop','')=''
    );
  if v_bad<>0 then raise exception 'v3.7: invalid forward crypto signal metadata: %',v_bad; end if;

  select count(*) into v_bad
  from public.mtf_alert_events
  where market='crypto' and strategy_version='OB-LADDER-v3.6' and status in ('PENDING','SENDING');
  if v_bad<>0 then raise exception 'v3.7: stale v3.6 crypto alerts still deliverable: %',v_bad; end if;

  if (public.mtf_stats_snapshot()->>'collection_label') not like 'v3.7 crypto%' then
    raise exception 'v3.7: stats snapshot is not on the new cohort';
  end if;
end $$;

select public.mtf_stats_snapshot() as stats_snapshot;
select public.mtf_audit_status() as audit_status;
select public.mtf_system_status() as system_status;
