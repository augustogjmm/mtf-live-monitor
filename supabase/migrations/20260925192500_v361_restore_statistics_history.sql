-- v3.6.1
-- Restore the canonical v3.5 history in Statistics while continuing with v3.6 forward data.
-- Outcome semantics are version-aware:
--   v3.5 success = TP3, TP1/TP2 remain milestones/open.
--   v3.6 success = TP1 (final exit).
--   SL = failure in both, AMBIGUOUS excluded from hit/fail rate.

create or replace function public.mtf_stats_snapshot()
returns jsonb
language sql
security definer
set search_path to 'public','pg_temp'
as $function$
with base_legs as (
  select
    s.*,
    coalesce(nullif(s.context->>'setup_id',''),'legacy:'||s.id::text) setup_id
  from public.mtf_signals s
  where s.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6')
    and s.source='FORWARD'
    and coalesce(s.context->>'trigger_basis','') in (
      'entry_only_when_1m_range_crosses_exact_OB_center_line',
      'entry_only_when_intraday_range_crosses_exact_OB_center_line'
    )
),
setups_raw as (
  select
    strategy_version,
    setup_id,
    min(id) id,
    min(market) market,
    min(symbol) symbol,
    min(underlying) underlying,
    min(direction) direction,
    min(signal_time) signal_time,
    min(created_at) created_at,
    avg(entry) entry,
    (array_agg(stop order by signal_time,id))[1] stop,
    (array_agg(tp1 order by signal_time,id))[1] tp1,
    (array_agg(tp2 order by signal_time,id))[1] tp2,
    (array_agg(tp3 order by signal_time,id))[1] tp3,
    bool_or(status='AMBIGUOUS') any_ambiguous,
    bool_or(status='SL') any_sl,
    bool_or(status='TP1') any_tp1_status,
    bool_or(status='TP2') any_tp2_status,
    bool_or(status='TP3') any_tp3_status,
    bool_or(hit1) hit1,
    bool_or(hit2) hit2,
    bool_or(hit3) hit3,
    min(hit1_at) hit1_at,
    min(hit2_at) hit2_at,
    min(hit3_at) hit3_at,
    max(closed_at) closed_at,
    max(best_r) best_r,
    min(worst_r) worst_r,
    count(*) leg_count,
    jsonb_agg(
      jsonb_build_object(
        'id',id,'rank',context->>'entry_rank','entry',entry,'status',status,
        'best_r',best_r,'worst_r',worst_r
      )
      order by coalesce((context->>'entry_rank')::int,999),signal_time
    ) legs,
    (array_agg(context order by signal_time,id))[1] context
  from base_legs
  group by strategy_version,setup_id
),
setups as (
  select
    r.*,
    case
      when any_ambiguous then 'AMBIGUOUS'
      when any_sl then 'SL'
      when strategy_version='OB-LADDER-v3.6' and (any_tp1_status or hit1) then 'TP1'
      when strategy_version='OB-LADDER-v3.5' and (any_tp3_status or hit3) then 'TP3'
      else 'OPEN'
    end status,
    case
      when any_ambiguous then 'AMBIGUOUS'
      when any_sl then 'SL'
      when any_tp3_status then 'TP3'
      when any_tp2_status then 'TP2'
      when any_tp1_status then 'TP1'
      else 'OPEN'
    end raw_status
  from setups_raw r
),
sent_entry_ids as (
  select distinct unnest(a.signal_ids)::bigint signal_id
  from public.mtf_alert_events a
  where a.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6')
    and a.event_type='ENTRY'
    and a.status='SENT'
),
ops as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'setup_id',setup_id,'market',market,'symbol',symbol,'underlying',underlying,'direction',direction,
    'signal_time',signal_time,'created_at',created_at,'entry',entry,'stop',stop,'tp1',tp1,'tp2',tp2,'tp3',tp3,
    'status',status,'raw_status',raw_status,'best_r',best_r,'worst_r',worst_r,'hit1',hit1,'hit2',hit2,'hit3',hit3,
    'hit1_at',hit1_at,'hit2_at',hit2_at,'hit3_at',hit3_at,'closed_at',closed_at,
    'strategy_version',strategy_version,'source','FORWARD','context',context,
    'leg_count',leg_count,'legs',legs,'cohort_member',true,
    'legacy_strategy',strategy_version='OB-LADDER-v3.5'
  ) order by signal_time desc,setup_id),'[]'::jsonb) operations
  from setups
),
summary as (
  select jsonb_build_object(
    'total',count(*),
    'open',count(*) filter(where status='OPEN'),
    'closed',count(*) filter(where status in ('TP1','TP3','SL','AMBIGUOUS')),
    'tp1_reached',count(*) filter(where hit1 or raw_status in ('TP1','TP2','TP3')),
    'sl',count(*) filter(where status='SL'),
    'ambiguous',count(*) filter(where status='AMBIGUOUS'),
    'crypto',count(*) filter(where market='crypto'),
    'cedear',count(*) filter(where market='cedear'),
    'adr',count(*) filter(where market='merval'),
    'entries',coalesce(sum(leg_count),0),
    'v35',count(*) filter(where strategy_version='OB-LADDER-v3.5'),
    'v36',count(*) filter(where strategy_version='OB-LADDER-v3.6')
  ) j
  from setups
),
metrics as (
  select jsonb_build_object(
    'success_rate',case when count(*) filter(where status in ('TP1','TP3','SL'))>0
      then count(*) filter(where status in ('TP1','TP3'))::numeric/count(*) filter(where status in ('TP1','TP3','SL')) else null end,
    'failure_rate',case when count(*) filter(where status in ('TP1','TP3','SL'))>0
      then count(*) filter(where status='SL')::numeric/count(*) filter(where status in ('TP1','TP3','SL')) else null end,
    'tp1_rate',case when count(*)>0 then count(*) filter(where hit1 or raw_status in ('TP1','TP2','TP3'))::numeric/count(*) else null end,
    'avg_mfe_r',avg(best_r),'avg_mae_r',avg(worst_r),
    'avg_tp1_seconds',avg(extract(epoch from (hit1_at-signal_time))) filter(where hit1_at is not null)
  ) j
  from setups
),
alerts as (
  select jsonb_build_object(
    'entry',count(*) filter(where event_type='ENTRY'),
    'tp1',count(*) filter(where event_type='TP1'),
    'tp2',count(*) filter(where event_type='TP2'),
    'tp3',count(*) filter(where event_type='TP3'),
    'sl',count(*) filter(where event_type='SL'),
    'system',count(*) filter(where event_type='SYSTEM')
  ) j
  from public.mtf_alert_events
  where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6')
    and status='SENT'
),
reconciliation as (
  select jsonb_build_object(
    'current_open_entries',(select count(*) from base_legs b join setups s using(strategy_version,setup_id) where s.status='OPEN'),
    'current_open_setups',(select count(*) from setups where status='OPEN'),
    'valid_entries',(select count(*) from base_legs),
    'valid_setups',(select count(*) from setups),
    'valid_entries_with_telegram',(select count(*) from base_legs b where b.id in (select signal_id from sent_entry_ids)),
    'valid_entries_without_telegram',(select count(*) from base_legs b where b.id not in (select signal_id from sent_entry_ids)),
    'status',case
      when (select count(*) from base_legs b where b.id not in (select signal_id from sent_entry_ids))=0
      then 'OK' else 'MISMATCH' end
  ) j
)
select jsonb_build_object(
 'generated_at',now(),
 'collection_started_at',(select min(signal_time) from setups),
 'collection_label','Canonical forward operations · v3.5 history + v3.6 current',
 'definition','Statistics preserve valid v3.5 canonical history and append v3.6 forward operations. v3.5 success=TP3; v3.6 success=TP1; SL=failure; ambiguous excluded.',
 'operations',ops.operations,
 'summary',summary.j,
 'metrics',metrics.j,
 'alerts',alerts.j,
 'reconciliation',reconciliation.j
)
from ops,summary,metrics,alerts,reconciliation;
$function$;

grant execute on function public.mtf_stats_snapshot() to anon, authenticated, service_role;
