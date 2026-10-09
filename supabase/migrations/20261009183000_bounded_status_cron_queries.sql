-- Read cron history once without modifying extension-owned tables.
-- Preserve historical last-run semantics and every public response field.
SET lock_timeout = '2s';
SET statement_timeout = '15s';
DO $migration$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef('public.mtf_system_status()'::regprocedure) INTO definition;
  IF strpos(definition,'MTF_STATUS_CRON_SINGLE_SCAN')>0 THEN RETURN; END IF;
  IF strpos(definition,$old0$  v_jobs jsonb := '[]'::jsonb;$old0$)=0 THEN
    RAISE EXCEPTION 'Unexpected status RPC fragment 0; inspect before migration';
  END IF;
  definition := replace(definition,$old0$  v_jobs jsonb := '[]'::jsonb;$old0$,$new0$  v_jobs jsonb := '[]'::jsonb;
  v_cron_failures_24h bigint := 0;
  v_last_cron_failure timestamptz;$new0$);
  IF strpos(definition,$old1$  select coalesce(jsonb_agg(
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
$old1$)=0 THEN
    RAISE EXCEPTION 'Unexpected status RPC fragment 1; inspect before migration';
  END IF;
  definition := replace(definition,$old1$  select coalesce(jsonb_agg(
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
$old1$,$new1$  -- MTF_STATUS_CRON_SINGLE_SCAN
  with relevant_runs as materialized (
    select jobid,status,start_time,end_time,return_message
    from cron.job_run_details where jobid in (1,2,3,7,8,11)
  ), latest_runs as (
    select distinct on (jobid) jobid,status,start_time,end_time,return_message
    from relevant_runs order by jobid,start_time desc
  ), recent_counts as (
    select jobid,count(*)::int runs_24h,
      count(*) filter(where lower(coalesce(status,'')) not in ('succeeded','running'))::int failures_24h,
      max(start_time) filter(where lower(coalesce(status,'')) not in ('succeeded','running')) last_failure
    from relevant_runs where start_time >= now() - interval '24 hours'
    group by jobid
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'jobid',j.jobid,'schedule',j.schedule,'active',j.active,
      'last_status',lr.status,'last_start',lr.start_time,'last_end',lr.end_time,
      'last_message',left(coalesce(lr.return_message,''),240),
      'runs_24h',coalesce(c.runs_24h,0),'failures_24h',coalesce(c.failures_24h,0),
      'last_failure',c.last_failure
    ) order by j.jobid
  ),'[]'::jsonb),
    (select count(*) from relevant_runs where jobid in (1,2,3,7,8)
      and start_time >= now() - interval '24 hours'
      and lower(coalesce(status,'')) not in ('succeeded','running')),
    (select max(start_time) from relevant_runs
      where lower(coalesce(status,'')) not in ('succeeded','running'))
  into v_jobs,v_cron_failures_24h,v_last_cron_failure
  from cron.job j
  left join latest_runs lr on lr.jobid=j.jobid
  left join recent_counts c on c.jobid=j.jobid
  where j.jobid in (1,2,3,7,8,11);
$new1$);
  IF strpos(definition,$old2$(select count(*) from cron.job_run_details d
      where d.jobid in (1,2,3,7,8) and d.start_time>=now()-interval '24 hours'
        and lower(coalesce(d.status,'')) not in ('succeeded','running'))$old2$)=0 THEN
    RAISE EXCEPTION 'Unexpected status RPC fragment 2; inspect before migration';
  END IF;
  definition := replace(definition,$old2$(select count(*) from cron.job_run_details d
      where d.jobid in (1,2,3,7,8) and d.start_time>=now()-interval '24 hours'
        and lower(coalesce(d.status,'')) not in ('succeeded','running'))$old2$,$new2$v_cron_failures_24h$new2$);
  IF strpos(definition,$old3$(select max(start_time) from cron.job_run_details
      where jobid in (1,2,3,7,8,11) and lower(coalesce(status,'')) not in ('succeeded','running'))$old3$)=0 THEN
    RAISE EXCEPTION 'Unexpected status RPC fragment 3; inspect before migration';
  END IF;
  definition := replace(definition,$old3$(select max(start_time) from cron.job_run_details
      where jobid in (1,2,3,7,8,11) and lower(coalesce(status,'')) not in ('succeeded','running'))$old3$,$new3$v_last_cron_failure$new3$);
  EXECUTE definition;
END
$migration$;
RESET lock_timeout;
RESET statement_timeout;
