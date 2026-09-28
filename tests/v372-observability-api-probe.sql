-- v3.7.2 observability API-layer regression checks.
select public.mtf_api_status_probe() as queued;
select public.mtf_observability_probe() as harvested;
select public.mtf_http_error_status() as errors;

select jobid,jobname,schedule,active
from cron.job
where jobname in ('mtf_observability_probe','mtf_api_status_probe')
order by jobid;

select request_id,component,action,target,created_at
from public.mtf_net_request_map
order by created_at desc
limit 10;

select
  public.mtf_system_status()#>>'{build,strategy_version}' as strategy_version,
  public.mtf_stats_snapshot()->'reconciliation' as reconciliation;
