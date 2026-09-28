-- ADR-OB-v1.0 runtime/certification wiring.
-- Keep CEDEAR v3.6 and Crypto v3.7.3 isolated.

-- Remove stale merval rows left in the old shared regulated snapshot.
update public.mtf_state s
set meta = jsonb_set(
      s.meta,
      '{snapshot}',
      coalesce((
        select jsonb_agg(x order by ord)
        from jsonb_array_elements(coalesce(s.meta->'snapshot','[]'::jsonb)) with ordinality e(x,ord)
        where x->>'market' <> 'merval'
      ),'[]'::jsonb),
      true
    )
    || jsonb_build_object('merval_retired_to','ADR-OB-v1.0','merval_retired_at',now()),
    updated_at=now()
where s.market='regulated_live';

-- Dedicated ADR live job. Runs every 5 minutes on weekdays; engine itself requires USA OPEN.
do $body$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname='mtf_adr_live' limit 1;
  if jid is not null then perform cron.unschedule(jid); end if;
end
$body$;

select cron.schedule(
  'mtf_adr_live',
  '*/5 * * * 1-5',
  $cmd$
    select net.http_post(
      url := 'https://swhfftkhqmbtmbnoskoj.supabase.co/functions/v1/mtf-cron-dispatch',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='mtf_cron_secret' order by created_at desc limit 1)
      ),
      body := '{"action":"adr-live"}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cmd$
);

create or replace function public.mtf_adr_certification_status()
returns jsonb
language sql
security definer
set search_path to 'public','cron','pg_temp'
as $function$
with reg as (
  select version,activated_at,frozen,rules
  from public.mtf_strategy_registry
  where version='ADR-OB-v1.0'
),
state as (
  select last_run_at,updated_at,meta
  from public.mtf_state
  where market='adr_live'
),
signals as (
  select *
  from public.mtf_signals
  where strategy_version='ADR-OB-v1.0' and market='merval' and source='FORWARD'
),
violations as (
  select jsonb_build_object(
    'context_not_dw_bullish',count(*) filter(where
      coalesce(context->'context'->>'trend','')<>'ALCISTA'
      or coalesce(context->'macro_context'->'w1'->>'trend','')<>'ALCISTA'
    ),
    'rr_below_1_8',count(*) filter(where coalesce((context->>'planned_rr')::numeric,0)<1.8),
    'wrong_trigger_basis',count(*) filter(where coalesce(context->>'trigger_basis','')<>
      'closed_15m_bar_overlaps_daily_bullish_OB_crosses_center_and_closes_back_above_with_bullish_rejection'),
    'auto_stop_enabled',count(*) filter(where coalesce(context->>'stop_policy','')<>'REFERENCE_ONLY_NO_AUTO_EXIT'),
    'wrong_exit_policy',count(*) filter(where coalesce(context->>'exit_policy','')<>'TP1_FINAL'),
    'post_tp1_state',count(*) filter(where status in ('TP2','TP3')),
    'non_long',count(*) filter(where direction<>'LONG')
  ) j from signals
),
dups as (
  select count(*) n from (
    select symbol from signals where status='OPEN' group by symbol having count(*)>1
  ) q
),
job as (
  select jsonb_build_object(
    'jobid',j.jobid,'jobname',j.jobname,'schedule',j.schedule,'active',j.active,
    'last_status',lr.status,'last_start',lr.start_time,'last_end',lr.end_time,'last_message',lr.return_message
  ) j
  from cron.job j
  left join lateral (
    select status,start_time,end_time,return_message
    from cron.job_run_details d where d.jobid=j.jobid order by start_time desc limit 1
  ) lr on true
  where j.jobname='mtf_adr_live'
),
audit as (
  select jsonb_build_object(
    'rows',count(*),
    'last_at',max(evaluated_at),
    'entries',count(*) filter(where decision='ENTRY'),
    'errors',count(*) filter(where decision='ERROR')
  ) j
  from public.mtf_decision_audit
  where strategy_version='ADR-OB-v1.0'
),
snapshot as (
  select jsonb_build_object(
    'strategy_version',state.meta->>'strategy_version',
    'engine',state.meta->>'engine',
    'baseline',state.meta->'baseline',
    'snapshot_count',case when jsonb_typeof(state.meta->'snapshot')='array' then jsonb_array_length(state.meta->'snapshot') else 0 end,
    'ready_count',case when jsonb_typeof(state.meta->'snapshot')='array'
      then (select count(*) from jsonb_array_elements(state.meta->'snapshot') x where coalesce((x->>'ready')::boolean,false))
      else 0 end,
    'funnel',state.meta->'funnel',
    'last_run_at',state.last_run_at
  ) j
  from state
)
select jsonb_build_object(
  'certification','ADR_CERT_V1',
  'strategy',coalesce((select jsonb_build_object('version',version,'activated_at',activated_at,'frozen',frozen,'rules',rules) from reg),'{}'::jsonb),
  'runtime',coalesce((select j from snapshot),'{}'::jsonb),
  'job',coalesce((select j from job),'{}'::jsonb),
  'audit',coalesce((select j from audit),'{}'::jsonb),
  'signals',jsonb_build_object(
    'total',(select count(*) from signals),
    'open',(select count(*) from signals where status='OPEN'),
    'tp1',(select count(*) from signals where status='TP1'),
    'violations',(select j from violations),
    'duplicate_open_assets',(select n from dups)
  ),
  'checks',jsonb_build_object(
    'registry_frozen',coalesce((select frozen from reg),false),
    'runtime_version_ok',coalesce((select meta->>'strategy_version'='ADR-OB-v1.0' from state),false),
    'runtime_engine_ok',coalesce((select meta->>'engine'='ADR_DW_15M_RECOVERY_V1' from state),false),
    'snapshot_complete',coalesce((select jsonb_array_length(coalesce(meta->'snapshot','[]'::jsonb))=14 from state),false),
    'cron_active',coalesce((select active from cron.job where jobname='mtf_adr_live' limit 1),false),
    'no_signal_rule_violations',(
      coalesce(((select j from violations)->>'context_not_dw_bullish')::int,0)
      +coalesce(((select j from violations)->>'rr_below_1_8')::int,0)
      +coalesce(((select j from violations)->>'wrong_trigger_basis')::int,0)
      +coalesce(((select j from violations)->>'auto_stop_enabled')::int,0)
      +coalesce(((select j from violations)->>'wrong_exit_policy')::int,0)
      +coalesce(((select j from violations)->>'post_tp1_state')::int,0)
      +coalesce(((select j from violations)->>'non_long')::int,0)
    )=0,
    'no_duplicate_open_assets',(select n=0 from dups)
  ),
  'generated_at',now()
);
$function$;

grant execute on function public.mtf_adr_certification_status() to anon,authenticated,service_role;
