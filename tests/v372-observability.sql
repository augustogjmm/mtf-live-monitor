-- Observability regression checks (read-only).
select public.mtf_observability_probe() as probe;
select public.mtf_http_error_status() as error_status;
select jobid,jobname,schedule,active
from cron.job
where jobname='mtf_observability_probe';
select status,start_time,end_time,return_message
from cron.job_run_details
where jobid=(select jobid from cron.job where jobname='mtf_observability_probe')
order by start_time desc
limit 5;
select
  (public.mtf_system_status()#>>'{build,status_schema}') as status_schema,
  public.mtf_audit_status()->>'strategy_version' as audit_strategy,
  public.mtf_stats_snapshot()->'reconciliation' as reconciliation;
