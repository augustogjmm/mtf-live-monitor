-- v3.6.5 observability closure. No trading-rule changes.

drop index if exists public.mtf_decision_audit_single_strategy_dedupe_idx;
create unique index if not exists mtf_decision_audit_cycle_dedupe_idx
  on public.mtf_decision_audit(strategy_version,cycle_id,market,symbol,signal_time);

create or replace function public.mtf_capture_live_decision_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  item jsonb;
  v_cycle text;
  v_market text;
  v_symbol text;
  v_underlying text;
  v_direction text;
  v_state text;
  v_decision text;
  v_reason text;
  v_signal_time timestamptz;
  v_ms numeric;
  v_context jsonb;
begin
  if new.market not in ('crypto_live','regulated_live') then return new; end if;
  if jsonb_typeof(new.meta->'snapshot') <> 'array' then return new; end if;
  v_cycle := new.market || ':' || to_char(coalesce(new.last_run_at,new.updated_at,now()) at time zone 'UTC','YYYYMMDD"T"HH24MISS.MS');

  for item in select value from jsonb_array_elements(new.meta->'snapshot')
  loop
    v_market := case when new.market='crypto_live' then 'crypto' else coalesce(nullif(item->>'market',''),'regulated') end;
    v_symbol := coalesce(nullif(item->>'symbol',''),'UNKNOWN');
    v_underlying := nullif(item->>'underlying','');
    v_state := upper(coalesce(nullif(item->>'state',''),'NO_ENTRY'));
    v_direction := coalesce(
      nullif(item->>'direction',''),
      nullif(item#>>'{proximity,nearest,direction}',''),
      case when v_market in ('cedear','merval') and coalesce((item->>'entry_allowed')::boolean,false) then 'LONG' end
    );

    v_ms := null;
    begin v_ms := nullif(item->>'last_bar_close','')::numeric; exception when others then v_ms := null; end;
    if coalesce(v_ms,0) <= 0 then
      begin v_ms := nullif(item->>'t','')::numeric; exception when others then v_ms := null; end;
    end if;
    v_signal_time := case when coalesce(v_ms,0)>0 then to_timestamp(v_ms/1000.0)
                          else coalesce(new.last_run_at,new.updated_at,now()) end;

    v_decision := case
      when coalesce(nullif(item->>'created','')::int,0) > 0 or v_state in ('ENTRY','OPEN') then 'ENTRY'
      when coalesce((item->>'ok')::boolean,true)=false or v_state in ('ERROR','NO_ANALYSIS') then 'ERROR'
      when v_state in ('BLOCKED','BLOCKED_OPEN') then 'BLOCKED_OPEN'
      when coalesce((item->>'entry_allowed')::boolean,true)=false and v_state in ('ZONE','IN_ZONE','NEAR','CLOSE') then 'BLOCKED_OPEN'
      else 'NO_ENTRY'
    end;

    v_reason := coalesce(nullif(item->>'reason',''), 'state='||v_state);
    v_context := jsonb_strip_nulls(jsonb_build_object(
      'source_state',new.market,
      'state',v_state,
      'price',item->'price',
      'setup_id',item->'setup_id',
      'open_count',item->'open_count',
      'actionable',item->'actionable',
      'entry_allowed',item->'entry_allowed',
      'nearest',item#>'{proximity,nearest}',
      'trend',item#>'{context,trend}',
      'macro_trend',coalesce(item#>'{macro_context,trend}',item#>'{macroContext,trend}'),
      'engine',new.meta->'engine'
    ));

    insert into public.mtf_decision_audit(
      strategy_version,cycle_id,market,symbol,underlying,direction,
      signal_time,evaluated_at,decision,reason,context
    ) values (
      'OB-LADDER-v3.6',v_cycle,v_market,v_symbol,v_underlying,v_direction,
      v_signal_time,coalesce(new.last_run_at,new.updated_at,now()),v_decision,v_reason,v_context
    )
    on conflict do nothing;
  end loop;
  return new;
end;
$function$;

drop trigger if exists mtf_live_decision_audit_trg on public.mtf_state;
create trigger mtf_live_decision_audit_trg
after insert or update of meta,last_run_at on public.mtf_state
for each row
when (new.market in ('crypto_live','regulated_live'))
execute function public.mtf_capture_live_decision_audit();

create or replace function public.mtf_audit_status()
returns jsonb
language sql
security definer
set search_path to 'public','pg_temp'
as $function$
with base as (
  select * from public.mtf_decision_audit where strategy_version='OB-LADDER-v3.6'
), last_cycles as (
  select distinct on (market) market,cycle_id,
    max(evaluated_at) over(partition by market,cycle_id) cycle_at,
    count(*) over(partition by market,cycle_id) rows_in_cycle
  from base order by market,cycle_at desc
), recent as (
  select jsonb_agg(jsonb_build_object(
    'id',id,'cycle_id',cycle_id,'market',market,'symbol',symbol,'underlying',underlying,
    'direction',direction,'signal_time',signal_time,'evaluated_at',evaluated_at,
    'decision',decision,'reason',reason,'context',context
  ) order by evaluated_at desc,id desc) items
  from (select * from base order by evaluated_at desc,id desc limit 30) q
), counts as (
  select count(*) total,
    count(*) filter(where evaluated_at>=now()-interval '24 hours') decisions_24h,
    count(distinct cycle_id) filter(where evaluated_at>=now()-interval '24 hours') cycles_24h,
    count(*) filter(where evaluated_at>=now()-interval '24 hours' and decision='ENTRY') entry_24h,
    count(*) filter(where evaluated_at>=now()-interval '24 hours' and decision='NO_ENTRY') no_entry_24h,
    count(*) filter(where evaluated_at>=now()-interval '24 hours' and decision='BLOCKED_OPEN') blocked_24h,
    count(*) filter(where evaluated_at>=now()-interval '24 hours' and decision='ERROR') errors_24h,
    max(evaluated_at) last_audit_at
  from base
), by_market as (
  select coalesce(jsonb_object_agg(market,j),'{}'::jsonb) j
  from (select market,jsonb_build_object(
    'total',count(*),'decisions_24h',count(*) filter(where evaluated_at>=now()-interval '24 hours'),
    'last_audit_at',max(evaluated_at),'last_signal_time',max(signal_time)
  ) j from base group by market) q
), cycles as (
  select coalesce(jsonb_object_agg(market,jsonb_build_object('cycle_id',cycle_id,'cycle_at',cycle_at,'rows',rows_in_cycle)),'{}'::jsonb) j
  from last_cycles
)
select jsonb_build_object(
  'strategy_version','OB-LADDER-v3.6','started_at',(select min(evaluated_at) from base),
  'last_audit_at',counts.last_audit_at,'total',counts.total,'decisions_24h',counts.decisions_24h,'cycles_24h',counts.cycles_24h,
  'decision_counts_24h',jsonb_build_object('ENTRY',counts.entry_24h,'NO_ENTRY',counts.no_entry_24h,'BLOCKED_OPEN',counts.blocked_24h,'ERROR',counts.errors_24h),
  'by_market',by_market.j,'last_cycles',cycles.j,'recent',coalesce(recent.items,'[]'::jsonb)
) from counts,by_market,cycles,recent;
$function$;

create table if not exists public.mtf_runtime_errors(
  id bigint generated by default as identity primary key,
  created_at timestamptz not null default now(),
  component text not null,
  action text,
  target text,
  status_code integer,
  error text,
  context jsonb not null default '{}'::jsonb
);
create index if not exists mtf_runtime_errors_created_idx on public.mtf_runtime_errors(created_at desc);
create index if not exists mtf_runtime_errors_component_idx on public.mtf_runtime_errors(component,created_at desc);
alter table public.mtf_runtime_errors enable row level security;
revoke all on public.mtf_runtime_errors from anon, authenticated;
grant all on public.mtf_runtime_errors to service_role;

create or replace function public.mtf_http_error_status()
returns jsonb
language sql
security definer
set search_path to 'net','public','pg_temp'
as $function$
with n as (
  select
    count(*) filter(where created>=now()-interval '24 hours' and status_code>=500) n5,
    count(*) filter(where created>=now()-interval '24 hours' and error_msg is not null) nt,
    max(created) filter(where status_code>=500 or error_msg is not null) last_at
  from net._http_response
), r as (
  select
    count(*) filter(where created_at>=now()-interval '24 hours' and coalesce(status_code,0)>=500) r5,
    count(*) filter(where created_at>=now()-interval '24 hours' and coalesce(status_code,0)=0) rt,
    max(created_at) filter(where coalesce(status_code,0)>=500 or error is not null) last_at
  from public.mtf_runtime_errors
), latest as (
  select error msg,created_at
  from public.mtf_runtime_errors
  where coalesce(status_code,0)>=500 or error is not null
  union all
  select coalesce(error_msg,left(content,300)),created
  from net._http_response
  where status_code>=500 or error_msg is not null
  order by created_at desc nulls last
  limit 1
)
select jsonb_build_object(
  'http_5xx_24h',coalesce(n.n5,0)+coalesce(r.r5,0),
  'transport_errors_24h',coalesce(n.nt,0)+coalesce(r.rt,0),
  'runtime_edge_errors_24h',coalesce(r.r5,0)+coalesce(r.rt,0),
  'last_http_error_at',greatest(n.last_at,r.last_at),
  'last_http_error',(select msg from latest limit 1)
) from n,r;
$function$;

do $$
declare v_sql text;
begin
  select pg_get_functiondef(p.oid) into v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f' and n.nspname='public' and p.proname='mtf_system_status'
  limit 1;
  if v_sql is not null then
    v_sql := replace(v_sql,'''status_schema'', ''3.6.3''','''status_schema'', ''3.6.5''');
    v_sql := replace(v_sql,'''status_schema'',''3.6.3''','''status_schema'',''3.6.5''');
    execute v_sql;
  end if;
end $$;
