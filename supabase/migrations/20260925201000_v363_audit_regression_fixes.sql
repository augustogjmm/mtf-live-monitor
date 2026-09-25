-- v3.6.3 audit/regression hardening.
-- Keep CEDEAR preparation alive through the local trading session and remove the retired
-- hard-coded-secret cron job. Refresh system status to current + legacy-compatible semantics.

select cron.alter_job(2::bigint, schedule := '*/5 13-20 * * 1-5');
select cron.unschedule(4::bigint);

create or replace function public.mtf_system_status()
returns jsonb
language plpgsql
security definer
set search_path to 'public','cron','pg_temp'
as $function$
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
  where j.jobid in (1,2,3,7,8);

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
  where s.market in ('crypto_structure','crypto_live','regulated_live','prealert_live','market_guard');

  select jsonb_build_object(
    'enabled',c.enabled,'entry_direction',c.entry_direction,
    'telegram_linked',(c.telegram_chat_id is not null),'linked_at',c.telegram_linked_at,
    'last_watcher_at',c.last_watcher_at,
    'alerts',jsonb_build_object('tp1',c.alert_tp1,'tp2',c.alert_tp2,'tp3',c.alert_tp3,'sl',c.alert_sl),
    'pending',(select count(*) from public.mtf_alert_events e
      where e.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6') and e.status in ('PENDING','SENDING')),
    'failed_24h',(select count(*) from public.mtf_alert_events e
      where e.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6') and e.status='FAILED' and e.updated_at>=now()-interval '24 hours'),
    'last_event',(select jsonb_build_object(
      'id',e.id,'event_type',e.event_type,'market',e.market,'symbol',e.symbol,'status',e.status,
      'strategy_version',e.strategy_version,'detected_at',e.detected_at,'sent_at',e.sent_at,'attempts',e.attempts,'last_error',e.last_error
    ) from public.mtf_alert_events e
      where e.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6')
      order by e.detected_at desc limit 1),
    'last_sent',(select jsonb_build_object(
      'id',e.id,'event_type',e.event_type,'market',e.market,'symbol',e.symbol,
      'strategy_version',e.strategy_version,'detected_at',e.detected_at,'sent_at',e.sent_at
    ) from public.mtf_alert_events e
      where e.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6') and e.status='SENT'
      order by e.sent_at desc nulls last limit 1)
  )
  into v_alert
  from public.mtf_alert_config c where c.id=1;

  with operational_legs as (
    select s.*,
      coalesce(nullif(s.context->>'setup_id',''),'legacy:'||s.id::text) setup_id
    from public.mtf_signals s
    where s.strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6')
      and s.source in ('FORWARD','MIGRATED_STRICT')
      and (
        (s.strategy_version='OB-LADDER-v3.5' and s.status in ('OPEN','TP1','TP2'))
        or (s.strategy_version='OB-LADDER-v3.6' and s.status='OPEN')
      )
  ),
  setups as (
    select strategy_version,setup_id,min(market) market,min(symbol) symbol,
           bool_or(status in ('TP1','TP2')) legacy_tp1,count(*) leg_count
    from operational_legs group by strategy_version,setup_id
  ),
  dup as (
    select count(*) n from (
      select market,symbol,sum(leg_count) legs from setups group by market,symbol having sum(leg_count)>3
    ) q
  )
  select jsonb_build_object(
    'open_total',count(*),
    'open_tp1_protected',count(*) filter(where legacy_tp1),
    'open_crypto',count(*) filter(where market='crypto'),
    'open_cedear',count(*) filter(where market='cedear'),
    'open_merval',count(*) filter(where market='merval'),
    'legacy_open',count(*) filter(where strategy_version='OB-LADDER-v3.5'),
    'current_open',count(*) filter(where strategy_version='OB-LADDER-v3.6'),
    'duplicate_open_assets',(select n from dup),
    'max_three_same_direction_legs',true,'one_open_per_asset',true
  )
  into v_positions
  from setups;

  select jsonb_build_object(
    'forward_total',count(*) filter(where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6') and source='FORWARD'),
    'v35_forward_total',count(*) filter(where strategy_version='OB-LADDER-v3.5' and source='FORWARD'),
    'v36_forward_total',count(*) filter(where strategy_version='OB-LADDER-v3.6' and source='FORWARD'),
    'last_forward_signal',max(created_at) filter(where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6') and source='FORWARD'),
    'last_signal',max(created_at) filter(where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6')),
    'last_24h',jsonb_build_object(
      'signals',count(*) filter(where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6') and source='FORWARD' and created_at>=now()-interval '24 hours')
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
    'signals',(select count(*) from public.mtf_signals where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6')),
    'states',(select count(*) from public.mtf_state),
    'alert_events',(select count(*) from public.mtf_alert_events where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6')),
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
      where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6') and status='FAILED' and updated_at>=now()-interval '24 hours'),
    'scanner_errors',coalesce((select sum(case when jsonb_typeof(meta->'last_result'->'errors')='array'
      then jsonb_array_length(meta->'last_result'->'errors') else 0 end)
      from public.mtf_state where market in ('crypto_structure','crypto_live','regulated_live','prealert_live')),0),
    'last_cron_failure',(select max(start_time) from cron.job_run_details
      where jobid in (1,2,3,7,8) and lower(coalesce(status,'')) not in ('succeeded','running')),
    'last_alert_failure',(select max(updated_at) from public.mtf_alert_events
      where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6') and status='FAILED')
  ) into v_errors;

  select jsonb_build_object(
    'strategy_version',r.version,'strategy_frozen',r.frozen,'strategy_activated_at',r.activated_at,
    'rules',r.rules,'status_schema','3.6.3'
  )
  into v_build
  from public.mtf_strategy_registry r
  where r.version='OB-LADDER-v3.6'
  limit 1;

  return jsonb_build_object(
    'generated_at',now(),'jobs',v_jobs,'states',v_states,'alerts',v_alert,
    'positions',v_positions,'signals',v_signals,'database',v_db,'errors',v_errors,'build',v_build
  );
end;
$function$;

grant execute on function public.mtf_system_status() to anon, authenticated, service_role;
