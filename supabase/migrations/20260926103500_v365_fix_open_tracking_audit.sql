-- v3.6.5 observability correction: OPEN is tracking, not a new ENTRY.
create or replace function public.mtf_capture_live_decision_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  item jsonb; v_cycle text; v_market text; v_symbol text; v_underlying text; v_direction text;
  v_state text; v_decision text; v_reason text; v_signal_time timestamptz; v_ms numeric; v_context jsonb;
begin
  if new.market not in ('crypto_live','regulated_live') then return new; end if;
  if jsonb_typeof(new.meta->'snapshot') <> 'array' then return new; end if;
  v_cycle := new.market || ':' || to_char(coalesce(new.last_run_at,new.updated_at,now()) at time zone 'UTC','YYYYMMDD"T"HH24MISS.MS');
  for item in select value from jsonb_array_elements(new.meta->'snapshot') loop
    v_market := case when new.market='crypto_live' then 'crypto' else coalesce(nullif(item->>'market',''),'regulated') end;
    v_symbol := coalesce(nullif(item->>'symbol',''),'UNKNOWN');
    v_underlying := nullif(item->>'underlying','');
    v_state := upper(coalesce(nullif(item->>'state',''),'NO_ENTRY'));
    v_direction := coalesce(nullif(item->>'direction',''),nullif(item#>>'{proximity,nearest,direction}',''),
      case when v_market in ('cedear','merval') and coalesce((item->>'entry_allowed')::boolean,false) then 'LONG' end);
    v_ms := null;
    begin v_ms := nullif(item->>'last_bar_close','')::numeric; exception when others then v_ms := null; end;
    if coalesce(v_ms,0)<=0 then begin v_ms := nullif(item->>'t','')::numeric; exception when others then v_ms := null; end; end if;
    v_signal_time := case when coalesce(v_ms,0)>0 then to_timestamp(v_ms/1000.0) else coalesce(new.last_run_at,new.updated_at,now()) end;
    v_decision := case
      when coalesce(nullif(item->>'created','')::int,0)>0 or v_state='ENTRY' then 'ENTRY'
      when coalesce((item->>'ok')::boolean,true)=false or v_state in ('ERROR','NO_ANALYSIS') then 'ERROR'
      when v_state in ('BLOCKED','BLOCKED_OPEN') then 'BLOCKED_OPEN'
      when coalesce((item->>'entry_allowed')::boolean,true)=false and v_state in ('ZONE','IN_ZONE','NEAR','CLOSE') then 'BLOCKED_OPEN'
      else 'NO_ENTRY'
    end;
    v_reason := coalesce(nullif(item->>'reason',''),'state='||v_state);
    v_context := jsonb_strip_nulls(jsonb_build_object(
      'source_state',new.market,'state',v_state,'price',item->'price','setup_id',item->'setup_id','open_count',item->'open_count',
      'actionable',item->'actionable','entry_allowed',item->'entry_allowed','nearest',item#>'{proximity,nearest}',
      'trend',item#>'{context,trend}','macro_trend',coalesce(item#>'{macro_context,trend}',item#>'{macroContext,trend}'),'engine',new.meta->'engine'));
    insert into public.mtf_decision_audit(strategy_version,cycle_id,market,symbol,underlying,direction,signal_time,evaluated_at,decision,reason,context)
    values('OB-LADDER-v3.6',v_cycle,v_market,v_symbol,v_underlying,v_direction,v_signal_time,coalesce(new.last_run_at,new.updated_at,now()),v_decision,v_reason,v_context)
    on conflict do nothing;
  end loop;
  return new;
end;
$function$;

truncate table public.mtf_decision_audit;
