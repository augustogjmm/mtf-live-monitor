-- Include legitimate 1m OB-touch entries in the existing clean forward stats cohort.
-- The earlier RPC required the obsolete 1h rejection trigger and silently excluded new live trades.
-- This migration is idempotent (CREATE OR REPLACE FUNCTION); the production RPC was updated first.
CREATE OR REPLACE FUNCTION public.mtf_stats_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with epoch as (
  select coalesce(
    (select started_at from public.mtf_stats_epochs where active=true order by started_at desc limit 1),
    now()
  ) started_at
),
base_legs as (
  select
    s.*,
    coalesce(nullif(s.context->>'setup_id',''),'legacy:'||s.id::text) setup_id
  from public.mtf_signals s, epoch e
  where s.source='FORWARD'
    and s.signal_time>=e.started_at
    and (
      (
        s.market='crypto'
        and s.strategy_version='OB-LADDER-v3.7.3'
        and coalesce(s.context->>'trigger_basis','') in ('closed_1h_rejection_from_active_ob','1m_range_crosses_active_1h_OB_point')
      )
      or (
        s.market='cedear'
        and s.strategy_version='OB-LADDER-v3.6'
      )
      or (
        s.market='merval'
        and s.strategy_version='ADR-OB-v1.0'
      )
    )
),
setups_raw as (
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
      when bool_or(status='SL' and coalesce(context->>'exit_reason','')='BREAK_EVEN') then 'BE'
      when bool_or(status='SL') then 'SL'
      when bool_or(status='TP1') or bool_or(hit1) then 'TP1'
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
    (array_agg(context order by signal_time,id))[1] context,
    min(strategy_version) strategy_version
  from base_legs
  group by setup_id
),
setups as (
  select * from setups_raw
),
sent_entry_ids as (
  select distinct unnest(a.signal_ids)::bigint signal_id
  from public.mtf_alert_events a, epoch e
  where a.strategy_version in ('OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')
    and a.event_type='ENTRY'
    and a.status='SENT'
    and a.detected_at>=e.started_at
),
ops as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'setup_id',setup_id,'market',market,'symbol',symbol,'underlying',underlying,'direction',direction,
    'signal_time',signal_time,'created_at',created_at,'entry',entry,'stop',stop,'tp1',tp1,'tp2',tp2,'tp3',tp3,
    'status',status,'raw_status',status,'best_r',best_r,'worst_r',worst_r,'hit1',hit1,'hit2',hit2,'hit3',hit3,
    'hit1_at',hit1_at,'hit2_at',hit2_at,'hit3_at',hit3_at,'closed_at',closed_at,
    'strategy_version',strategy_version,'source','FORWARD','context',context,
    'leg_count',leg_count,'legs',legs,'cohort_member',true,'legacy_strategy',false
  ) order by signal_time desc,setup_id),'[]'::jsonb) operations
  from setups
),
summary as (
  select jsonb_build_object(
    'total',count(*),
    'open',count(*) filter(where status='OPEN'),
    'closed',count(*) filter(where status in ('TP1','SL','BE','AMBIGUOUS')),
    'tp1_reached',count(*) filter(where status='TP1'),
    'sl',count(*) filter(where status='SL'),
    'be',count(*) filter(where status='BE'),
    'ambiguous',count(*) filter(where status='AMBIGUOUS'),
    'crypto',count(*) filter(where market='crypto'),
    'cedear',count(*) filter(where market='cedear'),
    'adr',count(*) filter(where market='merval'),
    'entries',coalesce(sum(leg_count),0),
    'v37_crypto',count(*) filter(where market='crypto' and strategy_version='OB-LADDER-v3.7.3'),
    'v36_regulated',count(*) filter(where market='cedear' and strategy_version='OB-LADDER-v3.6'),
    'adr_v1',count(*) filter(where market='merval' and strategy_version='ADR-OB-v1.0')
  ) j
  from setups
),
metrics as (
  select jsonb_build_object(
    'success_rate',case when count(*) filter(where status in ('TP1','SL'))>0
      then count(*) filter(where status='TP1')::numeric/count(*) filter(where status in ('TP1','SL')) else null end,
    'failure_rate',case when count(*) filter(where status in ('TP1','SL'))>0
      then count(*) filter(where status='SL')::numeric/count(*) filter(where status in ('TP1','SL')) else null end,
    'be_rate',case when count(*)>0 then count(*) filter(where status='BE')::numeric/count(*) else null end,
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
    'ambiguous',count(*) filter(where event_type='AMBIGUOUS'),
    'system',count(*) filter(where event_type='SYSTEM')
  ) j
  from public.mtf_alert_events a, epoch e
  where a.strategy_version in ('OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')
    and a.status='SENT'
    and a.detected_at>=e.started_at
),
reconciliation as (
  select jsonb_build_object(
    'current_open_entries',(select count(*) from base_legs b join setups s using(setup_id) where s.status='OPEN'),
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
 'collection_started_at',(select started_at from epoch),
 'collection_label','v3.7.3 crypto (OB touch + previous H1 rejection) + v3.6 CEDEAR + ADR-OB-v1.0 · clean forward statistics',
 'definition','Crypto: v3.7.3. CEDEAR: v3.6. ADR: ADR-OB-v1.0 requires Daily+Weekly ALCISTA, closed-15m recovery confirmation from a Daily bullish OB and planned RR>=1.8; technical invalidation is reference-only, no automatic stop; TP1 is final success.',
 'operations',ops.operations,
 'summary',summary.j,
 'metrics',metrics.j,
 'alerts',alerts.j,
 'reconciliation',reconciliation.j
)
from ops,summary,metrics,alerts,reconciliation;
$function$
;
