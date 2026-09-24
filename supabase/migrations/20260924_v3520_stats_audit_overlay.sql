-- v3.5.20 statistics audit overlay
create or replace function public.mtf_stats_audit_overlay()
returns jsonb
language sql
security definer
set search_path='public','pg_temp'
as $$
with epoch as (
  select id,started_at,label from public.mtf_stats_epochs where active=true order by id desc limit 1
),
forward_base as (
  select s.*,coalesce(nullif(s.context->>'setup_id',''),'legacy:'||s.id::text) setup_id
  from public.mtf_signals s
  where s.strategy_version='OB-LADDER-v3.5' and s.source='FORWARD'
),
setup_first as (
  select setup_id,min(created_at) first_created_at,
         bool_or(coalesce((context->>'stats_epoch_excluded')::boolean,false)) excluded
  from forward_base group by setup_id
),
open_setups as (
  select distinct b.setup_id,(f.first_created_at>=e.started_at and not f.excluded) cohort_member
  from forward_base b join setup_first f using(setup_id) cross join epoch e
  where b.status in ('OPEN','TP1','TP2')
),
invalidated as (
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'market',a.market,'symbol',a.symbol,'underlying',a.underlying,'direction',a.direction,
      'signal_time',a.signal_time,'created_at',a.created_at,'entry',a.entry,'stop',a.stop,
      'tp1',a.tp1,'tp2',a.tp2,'tp3',a.tp3,'status','INVALIDATED',
      'invalidated_at',a.invalidated_at,'invalid_reason',a.invalid_reason,
      'setup_id',a.context->>'setup_id','entry_rank',a.context->>'entry_rank'
    ) order by a.invalidated_at desc,a.id desc),'[]'::jsonb) j
  from public.mtf_signals_invalidated_archive a
  where a.strategy_version='OB-LADDER-v3.5'
),
recovered as (
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'event_time',r.event_time,'event_type',r.event_type,'market',r.market,
      'symbol',r.symbol,'direction',r.direction,'entry',r.entry,'level',r.level,
      'payload',r.payload,'source',r.source,'recovered_at',r.recovered_at
    ) order by r.event_time desc,r.id desc),'[]'::jsonb) j
  from public.mtf_recovered_events r
),
duplicate_events as (
  select count(*) n from public.mtf_alert_events a
  where coalesce((a.payload->>'audit_duplicate')::boolean,false)
)
select jsonb_build_object(
  'epoch',jsonb_build_object('id',e.id,'started_at',e.started_at,'label',e.label),
  'tracking_summary',jsonb_build_object(
    'open_total',(select count(*) from open_setups),
    'open_cohort',(select count(*) from open_setups where cohort_member),
    'open_prior',(select count(*) from open_setups where not cohort_member),
    'invalidated_total',(select jsonb_array_length(j) from invalidated),
    'recovered_history_total',(select jsonb_array_length(j) from recovered),
    'duplicate_telegram_events_marked',(select n from duplicate_events)
  ),
  'invalidated_operations',(select j from invalidated),
  'recovered_history',(select j from recovered),
  'generated_at',now()
)
from epoch e;
$$;
revoke all on function public.mtf_stats_audit_overlay() from public,authenticated;
grant execute on function public.mtf_stats_audit_overlay() to anon,service_role;
