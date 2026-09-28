-- Harden observability without changing strategy rules.
-- Persist pg_net failures independently of Edge runtime survival and probe critical status RPCs.

create unique index if not exists mtf_runtime_errors_pgnet_request_idx
on public.mtf_runtime_errors ((context->>'request_id'))
where component='pg_net' and context ? 'request_id';

create or replace function public.mtf_observability_probe()
returns jsonb
language plpgsql
security invoker
set search_path to 'public','net','pg_temp'
as $function$
declare
  v_harvested integer := 0;
  v_probe_errors integer := 0;
  v_err text;
  v_state text;
begin
  insert into public.mtf_runtime_errors(component,action,target,status_code,error,context)
  select
    'pg_net',
    'scheduled_http',
    'mtf-cron-dispatch',
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
  where r.created >= now()-interval '10 minutes'
    and (coalesce(r.status_code,0)>=500 or coalesce(r.timed_out,false) or r.error_msg is not null)
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

  begin
    perform public.mtf_audit_status();
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    insert into public.mtf_runtime_errors(component,action,target,status_code,error,context)
    values('mtf-observability-probe','rpc_probe','mtf_audit_status',500,v_err,
           jsonb_build_object('sqlstate',v_state,'captured_from','database_probe'));
    v_probe_errors := v_probe_errors + 1;
  end;

  delete from public.mtf_runtime_errors where created_at < now()-interval '14 days';

  return jsonb_build_object(
    'ok',v_probe_errors=0,
    'harvested',v_harvested,
    'probe_errors',v_probe_errors,
    'checked_at',now()
  );
end;
$function$;

revoke all on function public.mtf_observability_probe() from public, anon, authenticated;
grant execute on function public.mtf_observability_probe() to postgres, service_role;

select cron.schedule(
  'mtf_observability_probe',
  '* * * * *',
  'select public.mtf_observability_probe();'
);

create or replace function public.mtf_http_error_status()
returns jsonb
language sql
security definer
set search_path to 'net','public','pg_temp'
as $function$
with persisted as (
  select created_at,component,action,target,status_code,error,context
  from public.mtf_runtime_errors
  where created_at>=now()-interval '24 hours'
), live_unharvested as (
  select
    r.created as created_at,
    'pg_net'::text as component,
    'scheduled_http'::text as action,
    'mtf-cron-dispatch'::text as target,
    r.status_code,
    coalesce(nullif(r.error_msg,''),
      case when coalesce(r.timed_out,false) then 'pg_net timed out'
           else 'HTTP '||coalesce(r.status_code::text,'unknown') end) as error,
    jsonb_build_object('request_id',r.id::text,'timed_out',r.timed_out,'captured_from','net._http_response_live') as context
  from net._http_response r
  where r.created>=now()-interval '24 hours'
    and (coalesce(r.status_code,0)>=500 or coalesce(r.timed_out,false) or r.error_msg is not null)
    and not exists (
      select 1 from public.mtf_runtime_errors p
      where p.component='pg_net' and p.context->>'request_id'=r.id::text
    )
), e as (
  select * from persisted
  union all
  select * from live_unharvested
), latest as (
  select error,created_at,component,target,status_code
  from e
  order by created_at desc
  limit 1
)
select jsonb_build_object(
  'http_5xx_24h',count(*) filter(where coalesce(status_code,0)>=500 and component<>'mtf-cron-dispatch'),
  'transport_errors_24h',count(*) filter(where coalesce(status_code,0)=0 and component='pg_net'),
  'runtime_edge_errors_24h',count(*) filter(where component='pg_net'),
  'downstream_errors_24h',count(*) filter(where component='mtf-cron-dispatch'),
  'status_probe_errors_24h',count(*) filter(where component='mtf-observability-probe'),
  'last_http_error_at',(select created_at from latest),
  'last_http_error',(select error from latest),
  'last_http_component',(select component from latest),
  'last_http_target',(select target from latest),
  'last_http_status',(select status_code from latest)
)
from e;
$function$;
