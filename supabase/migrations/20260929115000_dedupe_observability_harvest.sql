-- Prevent duplicate runtime errors from repeated pg_net response harvesting.
create index if not exists mtf_runtime_errors_request_id_idx on public.mtf_runtime_errors ((context->>'request_id')) where context ? 'request_id';
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

  return jsonb_build_object(
    'ok',v_probe_errors=0,
    'harvested',v_harvested,
    'probe_errors',v_probe_errors,
    'checked_at',now()
  );
end;
$function$
;
