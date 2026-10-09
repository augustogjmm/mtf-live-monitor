-- MTF v2 forward-only reset, keeping legacy signals and events unchanged.
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
  if new.source='FORWARD'
     and new.strategy_version in ('OB-LADDER-v3.7.3','OB-LADDER-v3.6','ADR-OB-v1.0','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0')
  then
    v_risk:=abs(new.entry-new.stop);
    v_reward:=case when new.direction='SHORT' then new.entry-new.tp1 else new.tp1-new.entry end;
    v_min:=case when new.strategy_version in ('ADR-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0') then 1.8 else 1.0 end;
    if v_risk is null or v_reward is null or v_risk<=0 or v_reward<=0 or v_reward < v_min*v_risk then
      raise exception 'RR_GATE_REJECTED strategy=% symbol=% reward=% risk=% min_rr=%',
        new.strategy_version,new.symbol,v_reward,v_risk,v_min
        using errcode='check_violation';
    end if;
  end if;
  return new;
end;
$function$;
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
        and s.strategy_version='MACD-OB-v2.0'
        and coalesce(s.context->>'trigger_basis','')='closed_15m_rejection_from_qualified_active_1h_ob'
      )
      or (
        s.market='cedear'
        and s.strategy_version='CEDEAR-MACD-OB-v2.0'
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
  where a.strategy_version in ('CEDEAR-MACD-OB-v2.0','ADR-OB-v1.0','MACD-OB-v2.0')
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
    'macd_crypto',count(*) filter(where market='crypto' and strategy_version='MACD-OB-v2.0'),
    'v36_regulated',count(*) filter(where market='cedear' and strategy_version='CEDEAR-MACD-OB-v2.0'),
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
  where a.strategy_version in ('CEDEAR-MACD-OB-v2.0','ADR-OB-v1.0','MACD-OB-v2.0')
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
 'collection_label',coalesce((select label from public.mtf_stats_epochs where active=true order by started_at desc limit 1),'Clean operational measurement'),
 'definition','Medicion activa desde el ultimo reinicio: solo operaciones nuevas. Crypto MACD-OB-v2.0: MACD 1H define direccion, tendencia de 1H y 4H debe coincidir, OB 1H validado y rechazo confirmado en vela 15m; beneficio a TP1 / riesgo >= 1.8R. TP1 cierra; stop estructural y BE tras +1R. CEDEAR CEDEAR-MACD-OB-v2.0: long solo, MACD diario mejorando y contexto diario alcista, rechazo 15m del OB y RR minimo 1.8. ADR ADR-OB-v1.0: tendencia diaria y semanal ALCISTA, recuperacion 15m, RR minimo 1.8. Historico previo archivado sin mezclarse en estadisticas activas.',
 'operations',ops.operations,
 'summary',summary.j,
 'metrics',metrics.j,
 'alerts',alerts.j,
 'reconciliation',reconciliation.j
)
from ops,summary,metrics,alerts,reconciliation;
$function$;
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
          'cached_coverage_pct',s.meta->'cached_coverage_pct',
          'fresh_quote_assets_60m',s.meta->'fresh_quote_assets_60m',
          'stale_or_pending_assets',s.meta->'stale_or_pending_assets',
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
      where e.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0') and e.status in ('PENDING','SENDING')),
    'failed_24h',(select count(*) from public.mtf_alert_events e
      where e.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0') and e.status='FAILED' and e.updated_at>=now()-interval '24 hours'),
    'last_event',(select jsonb_build_object(
      'id',e.id,'event_type',e.event_type,'market',e.market,'symbol',e.symbol,'status',e.status,
      'strategy_version',e.strategy_version,'detected_at',e.detected_at,'sent_at',e.sent_at,'attempts',e.attempts,'last_error',e.last_error
    ) from public.mtf_alert_events e
      where e.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0')
      order by e.detected_at desc limit 1),
    'last_sent',(select jsonb_build_object(
      'id',e.id,'event_type',e.event_type,'market',e.market,'symbol',e.symbol,
      'strategy_version',e.strategy_version,'detected_at',e.detected_at,'sent_at',e.sent_at
    ) from public.mtf_alert_events e
      where e.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0') and e.status='SENT'
      order by e.sent_at desc nulls last limit 1)
  )
  into v_alert
  from public.mtf_alert_config c where c.id=1;

  with operational_legs as (
    select s.*,
      coalesce(nullif(s.context->>'setup_id',''),'legacy:'||s.id::text) setup_id
    from public.mtf_signals s
    where s.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0')
      and s.source in ('FORWARD','MIGRATED_STRICT')
      and (
        (s.strategy_version='OB-LADDER-v3.5' and s.status in ('OPEN','TP1','TP2'))
        or (s.strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0','ADR-OB-v1.0') and s.status='OPEN')
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
    'current_open',count(*) filter(where strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0','ADR-OB-v1.0')),
    'duplicate_open_assets',(select n from dup),
    'max_three_same_direction_legs',(select n=0 from leg_violations),
    'one_open_per_asset',(select n=0 from dup)
  )
  into v_positions
  from setups;

  select jsonb_build_object(
    'forward_total',count(*) filter(where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0') and source='FORWARD' and coalesce(context->>'exit_reason','') not in ('INVALID_RR_LEGACY','DUPLICATE_SETUP_RECONCILIATION')),
    'v35_forward_total',count(*) filter(where strategy_version='OB-LADDER-v3.5' and source='FORWARD' and coalesce(context->>'exit_reason','') not in ('INVALID_RR_LEGACY','DUPLICATE_SETUP_RECONCILIATION')),
    'v36_forward_total',count(*) filter(where strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7.3') and source='FORWARD' and coalesce(context->>'exit_reason','') not in ('INVALID_RR_LEGACY','DUPLICATE_SETUP_RECONCILIATION')),
    'last_forward_signal',max(created_at) filter(where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0') and source='FORWARD' and coalesce(context->>'exit_reason','') not in ('INVALID_RR_LEGACY','DUPLICATE_SETUP_RECONCILIATION')),
    'last_signal',max(created_at) filter(where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0')),
    'last_24h',jsonb_build_object(
      'signals',count(*) filter(where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0') and source='FORWARD' and coalesce(context->>'exit_reason','') not in ('INVALID_RR_LEGACY','DUPLICATE_SETUP_RECONCILIATION') and created_at>=now()-interval '24 hours')
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
    'signals',(select count(*) from public.mtf_signals where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0') and coalesce(context->>'exit_reason','') not in ('INVALID_RR_LEGACY','DUPLICATE_SETUP_RECONCILIATION')),
    'states',(select count(*) from public.mtf_state),
    'alert_events',(select count(*) from public.mtf_alert_events where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0')),
    'cedear_universe',(select count(*) from public.mtf_cedear_work
      where run_date=(select max(run_date) from public.mtf_cedear_work) and eligible_liquid=true),
    'cedear_work_errors',(select count(*) from public.mtf_cedear_work
      where run_date=(select max(run_date) from public.mtf_cedear_work) and last_error is not null),
    'cedear_eligible_pending',greatest(0,
      coalesce((select (meta->>'universe_size')::int from public.mtf_state where market='regulated_live'),0)
      -coalesce((select (meta->>'fresh_quote_assets_60m')::int from public.mtf_state where market='regulated_live'),0)),
    'cedear_live_fresh',(select (meta->>'fresh_quote_assets_60m')::int from public.mtf_state where market='regulated_live'),
    'cedear_live_stale',(select (meta->>'stale_or_pending_assets')::int from public.mtf_state where market='regulated_live')
  ) into v_db;

  select jsonb_build_object(
    'cron_failures_24h',(select count(*) from cron.job_run_details d
      where d.jobid in (1,2,3,7,8) and d.start_time>=now()-interval '24 hours'
        and lower(coalesce(d.status,'')) not in ('succeeded','running')),
    'alert_failures_24h',(select count(*) from public.mtf_alert_events
      where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0') and status='FAILED' and updated_at>=now()-interval '24 hours'),
    'http_5xx_24h', (select count(*) from public.mtf_runtime_errors e where e.created_at >= now()-interval '24 hours' and e.status_code >= 500),
    'http_5xx_30m', (select count(*) from public.mtf_runtime_errors e where e.created_at >= now()-interval '30 minutes' and e.status_code >= 500),
    'cedear_data_failures', (select count(*) from public.mtf_cedear_work where run_date=(select max(run_date) from public.mtf_cedear_work) and last_error is not null),
    'scanner_errors',coalesce((select sum(case when jsonb_typeof(meta->'last_result'->'errors')='array'
      then jsonb_array_length(meta->'last_result'->'errors') else 0 end)
      from public.mtf_state where market in ('crypto_structure','crypto_live','regulated_live','adr_live','prealert_live')),0),
    'last_cron_failure',(select max(start_time) from cron.job_run_details
      where jobid in (1,2,3,7,8,11) and lower(coalesce(status,'')) not in ('succeeded','running')),
    'last_alert_failure',(select max(updated_at) from public.mtf_alert_events
      where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3','MACD-OB-v1.0','CEDEAR-MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0') and status='FAILED')
  ) into v_errors;

  select jsonb_build_object(
    'strategy_version',r.version,'strategy_frozen',r.frozen,'strategy_activated_at',r.activated_at,
    'rules',r.rules,'status_schema','MACD-OB-v2.0'
  )
  into v_build
  from public.mtf_strategy_registry r
  where r.version='MACD-OB-v2.0'
  limit 1;

  return jsonb_build_object(
    'generated_at',now(),'jobs',v_jobs,'states',v_states,'alerts',v_alert,
    'positions',v_positions,'signals',v_signals,'database',v_db,'errors',v_errors,'build',v_build
  );
end;
$function$;
CREATE UNIQUE INDEX IF NOT EXISTS mtf_crypto_v2_one_open_per_asset
 ON public.mtf_signals(market,symbol)
 WHERE market='crypto' AND strategy_version='MACD-OB-v2.0' AND source='FORWARD' AND status='OPEN';
INSERT INTO public.mtf_strategy_registry(version,activated_at,frozen,rules) VALUES
('MACD-OB-v2.0',transaction_timestamp(),true,jsonb_build_object(
 'engine','MTF_CONFIRMED_OB_15M_V2','scope','crypto','operational_timeframe','1h','macro_timeframe','4h',
 'direction','LONG_SHORT_FAVOR_TREND','trend_filter','1H_4H_must_match','h1_structure','not_opposed',
 'momentum','H1_MACD_aligned_and_histogram_accelerating',
 'order_block_quality','pivot_volume_with_5bar_structural_displacement',
 'confirmation','closed_15m_rejection_20pct_wick_reclaim_center',
 'entry','closed_15m_close','stop','selected_OB_edge_plus_0.25_ATR14',
 'minimum_rr',1.8,'tp1','nearest_opposite_OB','exit','TP1_final_or_structural_SL_plus_1R_break_even')),
('CEDEAR-MACD-OB-v2.0',transaction_timestamp(),true,jsonb_build_object(
 'engine','CEDEAR_D1_MACD_OB_15M_V2','scope','cedear','direction','LONG_ONLY',
 'trend','Daily_ALCISTA_MACD_positive_improving_Weekly_not_bearish',
 'confirmation','closed_15m_bullish_rejection_of_daily_OB_center',
 'entry','closed_15m_close','stop','selected_daily_OB_low_minus_0.25_Daily_ATR14_reference_only',
 'minimum_rr',1.8,'tp1','nearest_opposite_daily_OB','exit','TP1_final',
 'liquidity','BYMA_ADTV40_20M_ARS_and_75pct_persistence'))
ON CONFLICT(version) DO NOTHING;
UPDATE public.mtf_stats_epochs SET active=false WHERE active=true;
INSERT INTO public.mtf_stats_epochs(started_at,label,notes,active) VALUES
(transaction_timestamp(),'MTF v2 · 15m confirmado · RR≥1.8',
 'Nueva medicion forward-only para cripto v2 y CEDEAR v2; historicos previos conservados. QNT cripto v1 y AAL CEDEAR v1 siguen monitoreados, fuera de estadisticas nuevas. ADR v1 continua.',true);
UPDATE public.mtf_alert_config SET strategy_version='MACD-OB-v2.0',
 activated_at=transaction_timestamp(),updated_at=transaction_timestamp() WHERE id=1;
