-- OB-LADDER-v3.6
-- Forward-only strategy:
-- * Crypto blocks CONTRA_TENDENCIA on every leg, allows A_FAVOR/RANGO.
-- * Regulated is long-only and requires Daily + Weekly ALCISTA on every leg.
-- * TP1 is the final system exit. Crypto keeps structural SL; regulated has no automatic SL.

insert into public.mtf_strategy_registry(version,activated_at,frozen,rules)
values (
  'OB-LADDER-v3.6',
  now(),
  true,
  jsonb_build_object(
    'engine','ANALYZER_CANONICAL_V3_6',
    'forward_only',true,
    'crypto',jsonb_build_object(
      'operational_timeframe','1H',
      'context',jsonb_build_array('1H','4H','1D'),
      'entry_filter','block CONTRA_TENDENCIA; allow A_FAVOR and RANGO',
      'per_leg_context_revalidation',true,
      'max_legs',3,
      'trigger','closed 1m exact OB center-line touch; entry bar excluded from exits',
      'stop_loss','structural SL remains operational',
      'exit','TP1 full close'
    ),
    'regulated',jsonb_build_object(
      'mode','spot_long_only',
      'operational_timeframe','1D',
      'dominant_context_timeframe','1W',
      'entry_filter','Daily ALCISTA AND Weekly ALCISTA',
      'per_leg_context_revalidation',true,
      'max_legs',3,
      'trigger','fresh origin-market intraday USD exact OB center-line touch',
      'stop_loss','none',
      'exit','TP1 full close'
    ),
    'tp2_tp3','reference_only',
    'telegram_dedupe','delivery only; never blocks strategy'
  )
)
on conflict (version) do update
set activated_at=excluded.activated_at,
    frozen=excluded.frozen,
    rules=excluded.rules;

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
  where s.strategy_version='OB-LADDER-v3.6'
    and s.source='FORWARD'
    and coalesce(s.context->>'trigger_basis','') in (
      'entry_only_when_1m_range_crosses_exact_OB_center_line',
      'entry_only_when_intraday_range_crosses_exact_OB_center_line'
    )
),
setups as (
  select
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
    case
      when bool_or(status='AMBIGUOUS') then 'AMBIGUOUS'
      when bool_or(status='SL') then 'SL'
      when bool_or(status='TP1') then 'TP1'
      else 'OPEN'
    end status,
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
  group by setup_id
),
sent_entry_ids as (
  select distinct unnest(a.signal_ids)::bigint signal_id
  from public.mtf_alert_events a
  where a.strategy_version='OB-LADDER-v3.6'
    and a.event_type='ENTRY'
    and a.status='SENT'
),
ops as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'setup_id',setup_id,'market',market,'symbol',symbol,'underlying',underlying,'direction',direction,
    'signal_time',signal_time,'created_at',created_at,'entry',entry,'stop',stop,'tp1',tp1,'tp2',tp2,'tp3',tp3,
    'status',status,'best_r',best_r,'worst_r',worst_r,'hit1',hit1,'hit2',hit2,'hit3',hit3,
    'hit1_at',hit1_at,'hit2_at',hit2_at,'hit3_at',hit3_at,'closed_at',closed_at,
    'strategy_version','OB-LADDER-v3.6','source','FORWARD','context',context,
    'leg_count',leg_count,'legs',legs,'cohort_member',true
  ) order by signal_time desc,setup_id),'[]'::jsonb) operations
  from setups
),
summary as (
  select jsonb_build_object(
    'total',count(*),
    'open',count(*) filter(where status='OPEN'),
    'closed',count(*) filter(where status in ('TP1','SL','AMBIGUOUS')),
    'tp1_reached',count(*) filter(where hit1 or status='TP1'),
    'sl',count(*) filter(where status='SL'),
    'ambiguous',count(*) filter(where status='AMBIGUOUS'),
    'crypto',count(*) filter(where market='crypto'),
    'cedear',count(*) filter(where market='cedear'),
    'adr',count(*) filter(where market='merval'),
    'entries',coalesce(sum(leg_count),0)
  ) j
  from setups
),
metrics as (
  select jsonb_build_object(
    'success_rate',case when count(*) filter(where status in ('TP1','SL'))>0
      then count(*) filter(where status='TP1')::numeric/count(*) filter(where status in ('TP1','SL')) else null end,
    'failure_rate',case when count(*) filter(where status in ('TP1','SL'))>0
      then count(*) filter(where status='SL')::numeric/count(*) filter(where status in ('TP1','SL')) else null end,
    'tp1_rate',case when count(*)>0 then count(*) filter(where hit1 or status='TP1')::numeric/count(*) else null end,
    'avg_mfe_r',avg(best_r),'avg_mae_r',avg(worst_r),
    'avg_tp1_seconds',avg(extract(epoch from (hit1_at-signal_time))) filter(where hit1_at is not null)
  ) j
  from setups
),
alerts as (
  select jsonb_build_object(
    'entry',count(*) filter(where event_type='ENTRY'),
    'tp1',count(*) filter(where event_type='TP1'),
    'sl',count(*) filter(where event_type='SL'),
    'system',count(*) filter(where event_type='SYSTEM')
  ) j
  from public.mtf_alert_events
  where strategy_version='OB-LADDER-v3.6'
    and status='SENT'
),
reconciliation as (
  select jsonb_build_object(
    'current_open_entries',(select count(*) from base_legs where status='OPEN'),
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
 'collection_label','OB-LADDER-v3.6 forward operations',
 'definition','Forward-only v3.6: Crypto blocks CONTRA_TENDENCIA and allows A_FAVOR/RANGO; regulated requires Daily+Weekly ALCISTA; TP1 is final system exit; regulated has no automatic stop loss.',
 'operations',ops.operations,
 'summary',summary.j,
 'metrics',metrics.j,
 'alerts',alerts.j,
 'reconciliation',reconciliation.j
)
from ops,summary,metrics,alerts,reconciliation;
$function$;

grant execute on function public.mtf_stats_snapshot() to anon, authenticated, service_role;
