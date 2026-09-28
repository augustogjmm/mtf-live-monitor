-- Add a true HTTP-layer observability probe and request attribution map.
-- Prerequisites in Vault: mtf_project_url and mtf_publishable_key.
-- No strategy, entry, stop or target logic is changed.

create table if not exists public.mtf_net_request_map(
  request_id bigint primary key,
  created_at timestamptz not null default now(),
  component text not null,
  action text,
  target text not null
);
alter table public.mtf_net_request_map enable row level security;
revoke all on public.mtf_net_request_map from anon, authenticated;
grant all on public.mtf_net_request_map to service_role, postgres;

create index if not exists mtf_net_request_map_created_idx
on public.mtf_net_request_map(created_at desc);

create or replace function public.mtf_api_status_probe()
returns jsonb
language plpgsql
security invoker
set search_path to 'public','net','vault','pg_temp'
as $function$
declare
  v_url text;
  v_key text;
  v_system_id bigint;
  v_audit_id bigint;
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
    headers := jsonb_build_object('Content-Type','application/json','apikey',v_key,'Authorization','Bearer '||v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  ) into v_system_id;

  insert into public.mtf_net_request_map(request_id,component,action,target)
  values(v_system_id,'mtf-api-probe','rpc_probe','mtf_system_status')
  on conflict(request_id) do nothing;

  select net.http_post(
    url := v_url || '/rest/v1/rpc/mtf_audit_status',
    headers := jsonb_build_object('Content-Type','application/json','apikey',v_key,'Authorization','Bearer '||v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  ) into v_audit_id;

  insert into public.mtf_net_request_map(request_id,component,action,target)
  values(v_audit_id,'mtf-api-probe','rpc_probe','mtf_audit_status')
  on conflict(request_id) do nothing;

  return jsonb_build_object('ok',true,'system_request_id',v_system_id,'audit_request_id',v_audit_id,'queued_at',now());
end;
$function$;

revoke all on function public.mtf_api_status_probe() from public, anon, authenticated;
grant execute on function public.mtf_api_status_probe() to postgres, service_role;

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
    coalesce(m.component,'pg_net'),
    coalesce(m.action,'scheduled_http'),
    coalesce(m.target,'mtf-cron-dispatch'),
    r.status_code,
    coalesce(nullif(r.error_msg,''),
      case when coalesce(r.timed_out,false) then 'pg_net timed out'
           else 'HTTP '||coalesce(r.status_code::text,'unknown') end),
    jsonb_strip_nulls(jsonb_build_object(
      'request_id',r.id::text,'timed_out',r.timed_out,'content',left(r.content,800),
      'captured_from','net._http_response','response_created_at',r.created
    ))
  from net._http_response r
  left join public.mtf_net_request_map m on m.request_id=r.id
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
  delete from public.mtf_net_request_map where created_at < now()-interval '14 days';

  return jsonb_build_object('ok',v_probe_errors=0,'harvested',v_harvested,'probe_errors',v_probe_errors,'checked_at',now());
end;
$function$;

revoke all on function public.mtf_observability_probe() from public, anon, authenticated;
grant execute on function public.mtf_observability_probe() to postgres, service_role;

select cron.schedule('mtf_api_status_probe','* * * * *','select public.mtf_api_status_probe();');

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
    coalesce(m.component,'pg_net') as component,
    coalesce(m.action,'scheduled_http') as action,
    coalesce(m.target,'mtf-cron-dispatch') as target,
    r.status_code,
    coalesce(nullif(r.error_msg,''),
      case when coalesce(r.timed_out,false) then 'pg_net timed out'
           else 'HTTP '||coalesce(r.status_code::text,'unknown') end) as error,
    jsonb_build_object('request_id',r.id::text,'timed_out',r.timed_out,'captured_from','net._http_response_live') as context
  from net._http_response r
  left join public.mtf_net_request_map m on m.request_id=r.id
  where r.created>=now()-interval '24 hours'
    and (coalesce(r.status_code,0)>=500 or coalesce(r.timed_out,false) or r.error_msg is not null)
    and not exists (
      select 1 from public.mtf_runtime_errors p
      where p.context->>'request_id'=r.id::text
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
  'transport_errors_24h',count(*) filter(where coalesce(status_code,0)=0 and component in ('pg_net','mtf-api-probe')),
  'runtime_edge_errors_24h',count(*) filter(where component in ('pg_net','mtf-api-probe')),
  'downstream_errors_24h',count(*) filter(where component='mtf-cron-dispatch'),
  'status_probe_errors_24h',count(*) filter(where component in ('mtf-observability-probe','mtf-api-probe')),
  'last_http_error_at',(select created_at from latest),
  'last_http_error',(select error from latest),
  'last_http_component',(select component from latest),
  'last_http_target',(select target from latest),
  'last_http_status',(select status_code from latest)
)
from e;
$function$;
