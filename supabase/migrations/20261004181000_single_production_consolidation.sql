-- MTF Monitor: single production version consolidation
-- 2026-10-04
begin;

alter table public.mtf_signals drop constraint if exists mtf_signals_geometry_check;
alter table public.mtf_signals add constraint mtf_signals_geometry_check check (
 (direction='LONG' and stop<=entry and tp1>entry and tp2>=tp1 and tp3>=tp2)
 or (direction='SHORT' and stop>=entry and tp1<entry and tp2<=tp1 and tp3<=tp2)
);

update public.mtf_signals
set context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
 'exit_reason','INVALID_RR_LEGACY','rr_policy_min',1.0,'invalidated_at',now()
),updated_at=now()
where source='FORWARD' and strategy_version='OB-LADDER-v3.7.3'
 and coalesce(context->>'exit_reason','')=''
 and coalesce(nullif(context->>'planned_rr','')::numeric,
  abs(tp1-entry)/nullif(abs(entry-coalesce(nullif(context->>'initial_stop','')::numeric,stop)),0))<1.0;

with ranked as (
 select id,row_number() over(partition by market,symbol order by signal_time,id) rn
 from public.mtf_signals
 where market='crypto' and strategy_version='OB-LADDER-v3.7.3' and source='FORWARD' and status='OPEN'
)
update public.mtf_signals s
set status='AMBIGUOUS',closed_at=coalesce(s.closed_at,now()),
 context=coalesce(s.context,'{}'::jsonb)||jsonb_build_object('exit_reason','DUPLICATE_SETUP_RECONCILIATION','invalidated_at',now()),
 updated_at=now()
where s.id in(select id from ranked where rn>1);

create unique index if not exists mtf_crypto_v373_one_open_asset_uq
on public.mtf_signals(market,symbol)
where market='crypto' and strategy_version='OB-LADDER-v3.7.3' and source='FORWARD' and status='OPEN';

create index if not exists mtf_decision_audit_strategy_eval_market_idx
on public.mtf_decision_audit(strategy_version,evaluated_at desc,market,cycle_id)
include(decision,signal_time);

CREATE OR REPLACE FUNCTION public.mtf_validate_entry_rr()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_risk numeric;
  v_reward numeric;
  v_min numeric;
begin
  if new.source='FORWARD' and new.strategy_version in ('OB-LADDER-v3.7.3','OB-LADDER-v3.6','ADR-OB-v1.0') then
    v_risk:=abs(new.entry-new.stop);
    v_reward:=abs(new.tp1-new.entry);
    v_min:=case when new.strategy_version='ADR-OB-v1.0' then 1.8 else 1.0 end;
    if v_risk<=0 or v_reward<=0 or v_reward < v_min*v_risk then
      raise exception 'RR_GATE_REJECTED strategy=% symbol=% reward=% risk=% min_rr=%',
        new.strategy_version,new.symbol,v_reward,v_risk,v_min
        using errcode='check_violation';
    end if;
  end if;
  return new;
end;
$function$
;
drop trigger if exists mtf_signals_rr_guard on public.mtf_signals;
create trigger mtf_signals_rr_guard before insert on public.mtf_signals
for each row execute function public.mtf_validate_entry_rr();

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
    and coalesce(s.context->>'exit_reason','') not in ('INVALID_RR_LEGACY','DUPLICATE_SETUP_RECONCILIATION')
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
    and (a.event_type='SYSTEM' or exists (
      select 1 from unnest(a.signal_ids) sid join base_legs b on b.id=sid
    ))
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
    and (
      a.event_type='SYSTEM'
      or exists (select 1 from base_legs b where b.id=any(a.signal_ids))
    )
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
 'collection_label','Crypto v3.7.3 RR>=1 + CEDEAR v3.6 RR>=1 + ADR v1 RR>=1.8 · forward-only valid operations',
 'definition','Crypto v3.7.3: active 1H OB center touched by a closed 1m bar, H1 trend aligned, macro context not opposing, TP1 reward must be >= structural SL risk, TP1 final with structural SL and +1R break-even protection. CEDEAR v3.6: long-only with RR>=1. ADR v1: Daily+Weekly ALCISTA, closed-15m recovery confirmation and RR>=1.8.',
 'operations',ops.operations,
 'summary',summary.j,
 'metrics',metrics.j,
 'alerts',alerts.j,
 'reconciliation',reconciliation.j
)
from ops,summary,metrics,alerts,reconciliation;
$function$
;
CREATE OR REPLACE FUNCTION public.mtf_system_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'pg_temp'
AS $function$
declare
  v_jobs jsonb := '[]'::jsonb;
  v_states jsonb := '{}'::jsonb;
  v_alert jsonb := '{}'::jsonb;
  v_positions jsonb := '{}'::jsonb;
  v_signals jsonb := '{}'::jsonb;
  v_db jsonb := '{}'::jsonb;
  v_errors jsonb := '{}'::jsonb;
  v_build jsonb := '{}'::jsonb;
  v_latest_write timestamptz;
begin
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'jobid',j.jobid,'schedule',j.schedule,'active',j.active,
      'last_status',lr.status,'last_start',lr.start_time,'last_end',lr.end_time,
      'last_message',left(coalesce(lr.return_message,''),240),
      'runs_24h',coalesce(c.runs_24h,0),'failures_24h',coalesce(c.failures_24h,0),
      'last_failure',c.last_failure
    ) order by j.jobid
  ),'[]'::jsonb)
  into v_jobs
  from cron.job j
  left join lateral (
    select d.status,d.start_time,d.end_time,d.return_message
    from cron.job_run_details d where d.jobid=j.jobid
    order by d.start_time desc limit 1
  ) lr on true
  left join lateral (
    select
      count(*) filter(where d.start_time>=now()-interval '24 hours')::int runs_24h,
      count(*) filter(where d.start_time>=now()-interval '24 hours'
        and lower(coalesce(d.status,'')) not in ('succeeded','running'))::int failures_24h,
      max(d.start_time) filter(where d.start_time>=now()-interval '24 hours'
        and lower(coalesce(d.status,'')) not in ('succeeded','running')) last_failure
    from cron.job_run_details d where d.jobid=j.jobid
  ) c on true
  where j.jobid in (1,2,3,7,8,11);

  select coalesce(jsonb_object_agg(
    s.market,
    jsonb_build_object(
      'last_processed_at',s.last_processed_at,'last_run_at',s.last_run_at,'updated_at',s.updated_at,
      'meta',
      case s.market
        when 'crypto_structure' then jsonb_build_object(
          'strategy_version',s.meta->>'strategy_version','engine',s.meta->>'engine',
          'universe_count',case when jsonb_typeof(s.meta->'universe')='array' then jsonb_array_length(s.meta->'universe') else 0 end,
          'snapshot_count',case when jsonb_typeof(s.meta->'snapshot')='array' then jsonb_array_length(s.meta->'snapshot') else 0 end,
          'ready_count',case when jsonb_typeof(s.meta->'snapshot')='array' then
            (select count(*) from jsonb_array_elements(s.meta->'snapshot') x where coalesce((x->>'ready')::boolean,false)) else 0 end,
          'carried_open_count',case when jsonb_typeof(s.meta->'carried_open')='array' then jsonb_array_length(s.meta->'carried_open') else 0 end
        )
        when 'crypto_live' then jsonb_build_object(
          'strategy_version',s.meta->>'strategy_version','engine',s.meta->>'engine',
          'baseline',s.meta->'baseline',
          'snapshot_count',case when jsonb_typeof(s.meta->'snapshot')='array' then jsonb_array_length(s.meta->'snapshot') else 0 end
        )
        when 'regulated_live' then jsonb_build_object(
          'strategy_version',s.meta->>'strategy_version','engine',s.meta->>'engine',
          'baseline',s.meta->'baseline','coverage_pct',s.meta->'coverage_pct',
          'snapshot_count',case when jsonb_typeof(s.meta->'snapshot')='array' then jsonb_array_length(s.meta->'snapshot') else 0 end,
          'cedear_count',case when jsonb_typeof(s.meta->'snapshot')='array' then
            (select count(*) from jsonb_array_elements(s.meta->'snapshot') x where x->>'market'='cedear') else 0 end,
          'merval_count',case when jsonb_typeof(s.meta->'snapshot')='array' then
            (select count(*) from jsonb_array_elements(s.meta->'snapshot') x where x->>'market'='merval') else 0 end,
          'cursor',s.meta->'cursor','retry_queue',s.meta->'retry_queue',
          'full_cycle_completed',s.meta->'full_cycle_completed','chunk_size',s.meta->'chunk_size'
        )
        when 'adr_live' then jsonb_build_object(
          'strategy_version',s.meta->>'strategy_version','engine',s.meta->>'engine',
          'baseline',s.meta->'baseline',
          'snapshot_count',case when jsonb_typeof(s.meta->'snapshot')='array' then jsonb_array_length(s.meta->'snapshot') else 0 end,
          'ready_count',case when jsonb_typeof(s.meta->'snapshot')='array' then
            (select count(*) from jsonb_array_elements(s.meta->'snapshot') x where coalesce((x->>'ready')::boolean,false)) else 0 end,
          'cursor',s.meta->'cursor','chunk_size',s.meta->'chunk_size','funnel',s.meta->'funnel'
        )
        when 'prealert_live' then jsonb_build_object(
          'initialized',s.meta->'initialized','crypto_near',s.meta->'crypto_near',
          'regulated_zone',s.meta->'regulated_zone','generated_at',s.meta->'generated_at'
        )
        when 'market_guard' then s.meta
        else '{}'::jsonb
      end
    )
  ),'{}'::jsonb)
  into v_states
  from public.mtf_state s
  where s.market in ('crypto_structure','crypto_live','regulated_live','adr_live','prealert_live','market_guard');

  select jsonb_build_object(
    'enabled',c.enabled,'entry_direction',c.entry_direction,
    'telegram_linked',(c.telegram_chat_id is not null),'linked_at',c.telegram_linked_at,
    'last_watcher_at',c.last_watcher_at,
    'alerts',jsonb_build_object('tp1',c.alert_tp1,'tp2',c.alert_tp2,'tp3',c.alert_tp3,'sl',c.alert_sl),
    'pending',(select count(*) from public.mtf_alert_events e
      where e.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3') and e.status in ('PENDING','SENDING')),
    'failed_24h',(select count(*) from public.mtf_alert_events e
      where e.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3') and e.status='FAILED' and e.updated_at>=now()-interval '24 hours'),
    'last_event',(select jsonb_build_object(
      'id',e.id,'event_type',e.event_type,'market',e.market,'symbol',e.symbol,'status',e.status,
      'strategy_version',e.strategy_version,'detected_at',e.detected_at,'sent_at',e.sent_at,'attempts',e.attempts,'last_error',e.last_error
    ) from public.mtf_alert_events e
      where e.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')
      order by e.detected_at desc limit 1),
    'last_sent',(select jsonb_build_object(
      'id',e.id,'event_type',e.event_type,'market',e.market,'symbol',e.symbol,
      'strategy_version',e.strategy_version,'detected_at',e.detected_at,'sent_at',e.sent_at
    ) from public.mtf_alert_events e
      where e.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3') and e.status='SENT'
      order by e.sent_at desc nulls last limit 1)
  )
  into v_alert
  from public.mtf_alert_config c where c.id=1;

  with operational_legs as (
    select s.*,
      coalesce(nullif(s.context->>'setup_id',''),'legacy:'||s.id::text) setup_id
    from public.mtf_signals s
    where s.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')
      and s.source in ('FORWARD','MIGRATED_STRICT')
      and (
        (s.strategy_version='OB-LADDER-v3.5' and s.status in ('OPEN','TP1','TP2'))
        or (s.strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7.3') and s.status='OPEN')
      )
  ),
  setups as (
    select strategy_version,setup_id,min(market) market,min(symbol) symbol,
           bool_or(status in ('TP1','TP2')) legacy_tp1,count(*) leg_count
    from operational_legs group by strategy_version,setup_id
  ),
  dup as (
    select count(*) n from (
      select market,symbol,count(distinct setup_id) setup_count
      from operational_legs
      group by market,symbol
      having count(distinct setup_id)>1
    ) q
  ),
  leg_violations as (
    select count(*) n from (
      select strategy_version,setup_id,count(*) legs
      from operational_legs
      group by strategy_version,setup_id
      having count(*)>3
    ) q
  )
  select jsonb_build_object(
    'open_total',count(*),
    'open_tp1_protected',count(*) filter(where legacy_tp1),
    'open_crypto',count(*) filter(where market='crypto'),
    'open_cedear',count(*) filter(where market='cedear'),
    'open_merval',count(*) filter(where market='merval'),
    'legacy_open',count(*) filter(where strategy_version='OB-LADDER-v3.5'),
    'current_open',count(*) filter(where strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7.3')),
    'duplicate_open_assets',(select n from dup),
    'max_three_same_direction_legs',(select n=0 from leg_violations),
    'one_open_per_asset',(select n=0 from dup)
  )
  into v_positions
  from setups;

  select jsonb_build_object(
    'forward_total',count(*) filter(where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3') and source='FORWARD' and coalesce(context->>'exit_reason','') not in ('INVALID_RR_LEGACY','DUPLICATE_SETUP_RECONCILIATION')),
    'v35_forward_total',count(*) filter(where strategy_version='OB-LADDER-v3.5' and source='FORWARD' and coalesce(context->>'exit_reason','') not in ('INVALID_RR_LEGACY','DUPLICATE_SETUP_RECONCILIATION')),
    'v36_forward_total',count(*) filter(where strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7.3') and source='FORWARD' and coalesce(context->>'exit_reason','') not in ('INVALID_RR_LEGACY','DUPLICATE_SETUP_RECONCILIATION')),
    'last_forward_signal',max(created_at) filter(where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3') and source='FORWARD' and coalesce(context->>'exit_reason','') not in ('INVALID_RR_LEGACY','DUPLICATE_SETUP_RECONCILIATION')),
    'last_signal',max(created_at) filter(where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')),
    'last_24h',jsonb_build_object(
      'signals',count(*) filter(where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3') and source='FORWARD' and coalesce(context->>'exit_reason','') not in ('INVALID_RR_LEGACY','DUPLICATE_SETUP_RECONCILIATION') and created_at>=now()-interval '24 hours')
    )
  )
  into v_signals
  from public.mtf_signals;

  select greatest(
    coalesce((select max(updated_at) from public.mtf_signals),'epoch'::timestamptz),
    coalesce((select max(updated_at) from public.mtf_state),'epoch'::timestamptz),
    coalesce((select max(updated_at) from public.mtf_alert_events),'epoch'::timestamptz),
    coalesce((select max(updated_at) from public.mtf_alert_config),'epoch'::timestamptz)
  ) into v_latest_write;

  select jsonb_build_object(
    'last_write',v_latest_write,
    'signals',(select count(*) from public.mtf_signals where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3') and coalesce(context->>'exit_reason','') not in ('INVALID_RR_LEGACY','DUPLICATE_SETUP_RECONCILIATION')),
    'states',(select count(*) from public.mtf_state),
    'alert_events',(select count(*) from public.mtf_alert_events where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')),
    'cedear_universe',(select count(*) from public.mtf_cedear_work
      where run_date=(select max(run_date) from public.mtf_cedear_work) and eligible_liquid=true),
    'cedear_work_errors',(select count(*) from public.mtf_cedear_work
      where run_date=(select max(run_date) from public.mtf_cedear_work) and last_error is not null),
    'cedear_eligible_pending',(select count(*) from public.mtf_cedear_work
      where run_date=(select max(run_date) from public.mtf_cedear_work) and eligible_liquid=true and signal_done=false)
  ) into v_db;

  select jsonb_build_object(
    'cron_failures_24h',(select count(*) from cron.job_run_details d
      where d.jobid in (1,2,3,7,8) and d.start_time>=now()-interval '24 hours'
        and lower(coalesce(d.status,'')) not in ('succeeded','running')),
    'alert_failures_24h',(select count(*) from public.mtf_alert_events
      where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3') and status='FAILED' and updated_at>=now()-interval '24 hours'),
    'scanner_errors',coalesce((select sum(case when jsonb_typeof(meta->'last_result'->'errors')='array'
      then jsonb_array_length(meta->'last_result'->'errors') else 0 end)
      from public.mtf_state where market in ('crypto_structure','crypto_live','regulated_live','adr_live','prealert_live')),0),
    'last_cron_failure',(select max(start_time) from cron.job_run_details
      where jobid in (1,2,3,7,8,11) and lower(coalesce(status,'')) not in ('succeeded','running')),
    'last_alert_failure',(select max(updated_at) from public.mtf_alert_events
      where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3') and status='FAILED')
  ) into v_errors;

  select jsonb_build_object(
    'strategy_version',r.version,'strategy_frozen',r.frozen,'strategy_activated_at',r.activated_at,
    'rules',r.rules,'status_schema','3.7.3'
  )
  into v_build
  from public.mtf_strategy_registry r
  where r.version='OB-LADDER-v3.7.3'
  limit 1;

  return jsonb_build_object(
    'generated_at',now(),'jobs',v_jobs,'states',v_states,'alerts',v_alert,
    'positions',v_positions,'signals',v_signals,'database',v_db,'errors',v_errors,'build',v_build
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mtf_audit_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with epoch as (
  select coalesce(
    (select started_at from public.mtf_stats_epochs where active=true order by started_at desc limit 1),
    now()-interval '24 hours'
  ) started_at
),
totals as (
  select count(*) total,max(evaluated_at) last_audit_at
  from public.mtf_decision_audit d,epoch e
  where d.strategy_version in ('OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')
    and d.evaluated_at>=e.started_at
),
d24 as (
  select count(*) decisions_24h,count(distinct cycle_id) cycles_24h,
         count(*) filter(where decision='ENTRY') entry_24h,
         count(*) filter(where decision='NO_ENTRY') no_entry_24h,
         count(*) filter(where decision='BLOCKED_OPEN') blocked_24h,
         count(*) filter(where decision='ERROR') errors_24h
  from public.mtf_decision_audit d,epoch e
  where d.strategy_version in ('OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')
    and d.evaluated_at>=greatest(e.started_at,now()-interval '24 hours')
),
by_market as (
  select coalesce(jsonb_object_agg(market,j),'{}'::jsonb) j
  from (
    select market,jsonb_build_object(
      'total',count(*),
      'decisions_24h',count(*) filter(where evaluated_at>=now()-interval '24 hours'),
      'last_audit_at',max(evaluated_at),
      'last_signal_time',max(signal_time)
    ) j
    from public.mtf_decision_audit d,epoch e
    where d.strategy_version in ('OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')
      and d.evaluated_at>=e.started_at
    group by market
  ) q
),
last_per_market as (
  select distinct on (market) market,cycle_id,evaluated_at cycle_at
  from public.mtf_decision_audit d,epoch e
  where d.strategy_version in ('OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')
    and d.evaluated_at>=greatest(e.started_at,now()-interval '24 hours')
  order by market,evaluated_at desc
),
cycles as (
  select coalesce(jsonb_object_agg(l.market,jsonb_build_object(
    'cycle_id',l.cycle_id,'cycle_at',l.cycle_at,'rows',(
      select count(*) from public.mtf_decision_audit d
      where d.strategy_version in ('OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')
        and d.market=l.market and d.cycle_id=l.cycle_id
    )
  )),'{}'::jsonb) j
  from last_per_market l
),
recent as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'cycle_id',q.cycle_id,'market',q.market,'symbol',q.symbol,'underlying',q.underlying,
    'direction',q.direction,'signal_time',q.signal_time,'evaluated_at',q.evaluated_at,
    'decision',q.decision,'reason',q.reason,'context',q.context,'strategy_version',q.strategy_version
  ) order by q.evaluated_at desc,q.id desc),'[]'::jsonb) items
  from (
    select d.id,d.cycle_id,d.market,d.symbol,d.underlying,d.direction,d.signal_time,d.evaluated_at,
           d.decision,d.reason,d.context,d.strategy_version
    from public.mtf_decision_audit d,epoch e
    where d.strategy_version in ('OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')
      and d.evaluated_at>=greatest(e.started_at,now()-interval '24 hours')
    order by d.evaluated_at desc,d.id desc
    limit 30
  ) q
)
select jsonb_build_object(
 'strategy_version','OB-LADDER-v3.7.3 + v3.6 CEDEAR + ADR-OB-v1.0',
 'started_at',(select started_at from epoch),
 'last_audit_at',totals.last_audit_at,
 'total',totals.total,
 'decisions_24h',d24.decisions_24h,
 'cycles_24h',d24.cycles_24h,
 'decision_counts_24h',jsonb_build_object(
   'ENTRY',d24.entry_24h,'NO_ENTRY',d24.no_entry_24h,'BLOCKED_OPEN',d24.blocked_24h,'ERROR',d24.errors_24h
 ),
 'by_market',by_market.j,
 'last_cycles',cycles.j,
 'recent',recent.items
)
from totals,d24,by_market,cycles,recent;
$function$
;
CREATE OR REPLACE FUNCTION public.mtf_observability_probe()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'net', 'pg_temp'
AS $function$
declare
  v_harvested integer := 0;
  v_probe_errors integer := 0;
  v_err text;
  v_state text;
begin
  insert into public.mtf_runtime_errors(component,action,target,status_code,error,context)
  select
    coalesce(m.component,'pg_net'),
    coalesce(m.action,'scheduled_http'),
    coalesce(m.target,'mtf-cron-dispatch'),
    r.status_code,
    coalesce(
      nullif(r.error_msg,''),
      case when coalesce(r.timed_out,false) then 'pg_net timed out'
           else 'HTTP '||coalesce(r.status_code::text,'unknown') end
    ),
    jsonb_strip_nulls(jsonb_build_object(
      'request_id',r.id::text,
      'timed_out',r.timed_out,
      'content',left(r.content,800),
      'captured_from','net._http_response',
      'response_created_at',r.created
    ))
  from net._http_response r
  left join public.mtf_net_request_map m on m.request_id=r.id
  where r.created >= now()-interval '10 minutes'
    and (coalesce(r.status_code,0)>=500 or coalesce(r.timed_out,false) or r.error_msg is not null)
    and not exists (select 1 from public.mtf_runtime_errors prior where prior.context->>'request_id'=r.id::text and prior.component=coalesce(m.component,'pg_net'))
  on conflict do nothing;
  get diagnostics v_harvested = row_count;

  begin
    perform public.mtf_system_status();
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    insert into public.mtf_runtime_errors(component,action,target,status_code,error,context)
    values('mtf-observability-probe','rpc_probe','mtf_system_status',500,v_err,
           jsonb_build_object('sqlstate',v_state,'captured_from','database_probe'));
    v_probe_errors := v_probe_errors + 1;
  end;

  delete from public.mtf_runtime_errors where created_at < now()-interval '14 days';
  delete from public.mtf_net_request_map where created_at < now()-interval '14 days';

  return jsonb_build_object(
    'ok',v_probe_errors=0,
    'harvested',v_harvested,
    'probe_errors',v_probe_errors,
    'checked_at',now()
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mtf_api_status_probe()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'net', 'vault', 'pg_temp'
AS $function$
declare
  v_url text;
  v_key text;
  v_system_id bigint;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name='mtf_project_url'
  order by created_at desc
  limit 1;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name='mtf_publishable_key'
  order by created_at desc
  limit 1;

  if v_url is null or v_key is null then
    raise exception 'observability API probe credentials missing';
  end if;

  select net.http_post(
    url := v_url || '/rest/v1/rpc/mtf_system_status',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',v_key,
      'Authorization','Bearer '||v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  ) into v_system_id;

  insert into public.mtf_net_request_map(request_id,component,action,target)
  values(v_system_id,'mtf-api-probe','rpc_probe','mtf_system_status')
  on conflict(request_id) do nothing;

  return jsonb_build_object(
    'ok',true,
    'system_request_id',v_system_id,
    'queued_at',now()
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mtf_retention_cleanup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'cron', 'pg_temp'
AS $function$
declare
  v_audit integer := 0;
  v_runtime integer := 0;
  v_cron integer := 0;
begin
  delete from public.mtf_decision_audit
   where evaluated_at < now() - interval '36 hours';
  get diagnostics v_audit = row_count;

  delete from public.mtf_runtime_errors
   where created_at < now() - interval '3 days';
  get diagnostics v_runtime = row_count;

  delete from cron.job_run_details
   where start_time < now() - interval '36 hours';
  get diagnostics v_cron = row_count;

  return jsonb_build_object(
    'audit_deleted', v_audit,
    'runtime_errors_deleted', v_runtime,
    'cron_history_deleted', v_cron,
    'ran_at', now()
  );
end;
$function$
;

update public.mtf_strategy_registry
set rules=jsonb_build_object(
 'scope','crypto','engine','MTF_OB_TREND_RESTORED_V3_7_3',
 'operational_timeframe','1H','trigger_timeframe','1m closed bars',
 'entry','active 1H Order Block center touched by a closed 1m bar',
 'direction_filter','1H trend must match direction; 1H/4H/1D majority macro context must not oppose',
 'indicators_role','RSI, MACD and volume are informational context only; not hard entry gates',
 'minimum_rr',1.0,
 'target','nearest opposite active Order Block; TP1 reward must be at least structural risk',
 'stop','far edge of third same-side entry Order Block plus 0.25 ATR14',
 'exit','TP1 final; structural SL; after +1R on a closed 1m bar move active stop to break-even',
 'positioning','one open crypto setup per asset','forward_only',true,
 'same_bar_uncertainty','if TP1 or +1R and stop occur in the same 1m bar and order is unknowable, mark AMBIGUOUS',
 'regulated_strategy','OB-LADDER-v3.6',
 'database_guards',jsonb_build_array('RR floor trigger','unique open crypto asset index')
),frozen=true where version='OB-LADDER-v3.7.3';

analyze public.mtf_decision_audit;
commit;
