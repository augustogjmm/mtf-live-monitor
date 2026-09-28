-- CEDEAR liquidity fallback observability.
-- Keeps the existing public snapshot RPC compatible while exposing whether the
-- current BYMA turnover feed is valid or the universe is inherited from the
-- last valid liquid session.
create or replace function public.mtf_latest_cedear_snapshot()
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
with d as (
  select max(run_date) run_date
  from public.mtf_cedear_work
  where eligible_liquid=true
),
rows as (
  select w.run_date,w.symbol,w.underlying,w.liquidity_rank,w.metrics,w.raw,w.updated_at
  from public.mtf_cedear_work w,d
  where w.run_date=d.run_date
    and w.eligible_liquid=true
  order by w.liquidity_rank nulls last,w.symbol
),
feed as (
  select
    exists(
      select 1
      from rows
      where coalesce(nullif(metrics->>'adtv20','')::numeric,0) > 0
    ) as current_turnover_valid,
    (
      select max(w.run_date)
      from public.mtf_cedear_work w,d
      where w.run_date < d.run_date
        and w.eligible_liquid=true
        and coalesce(nullif(w.metrics->>'adtv20','')::numeric,0) > 0
    ) as fallback_run_date
)
select jsonb_build_object(
  'run_date',(select run_date from d),
  'total',(select count(*) from rows),
  'universe_rule',case
    when (select current_turnover_valid from feed) then 'BYMA_CURRENT_TURNOVER_CUM90_SPREAD2'
    else 'FALLBACK_LAST_VALID_BYMA_UNIVERSE'
  end,
  'liquidity_basis',case
    when (select current_turnover_valid from feed) then 'BYMA_CURRENT_TURNOVER'
    else 'BYMA_LAST_VALID_UNIVERSE_FALLBACK'
  end,
  'current_turnover_valid',(select current_turnover_valid from feed),
  'fallback_run_date',case
    when (select current_turnover_valid from feed) then null
    else (select fallback_run_date from feed)
  end,
  'updated_at',(select max(updated_at) from rows),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'symbol',symbol,
    'name',coalesce(nullif(raw->>'securityDesc',''),nullif(raw->>'description',''),symbol),
    'underlying',underlying,
    'rank',liquidity_rank,
    'adtv20',nullif(metrics->>'adtv20','')::numeric,
    'persistence',nullif(metrics->>'persistence','')::numeric,
    'spreadPct',nullif(metrics->>'spreadPct','')::numeric,
    'liquidity',metrics,
    'currentVolumeAmount',coalesce((raw->>'volumeAmount')::numeric,0)
  ) order by liquidity_rank nulls last,symbol) from rows),'[]'::jsonb)
);
$function$;
