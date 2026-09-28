-- CEDEAR liquidity fallback certification.
-- Every row must return ok=true in both normal and degraded feed modes.
with snap as (
  select public.mtf_latest_cedear_snapshot() j
),
meta as (
  select
    j,
    (j->>'run_date')::date run_date,
    j->>'liquidity_basis' basis,
    (j->>'current_turnover_valid')::boolean current_valid,
    nullif(j->>'fallback_run_date','')::date fallback_date,
    (j->>'total')::int total,
    j->>'universe_rule' universe_rule
  from snap
),
cur as (
  select w.*
  from public.mtf_cedear_work w,meta m
  where w.run_date=m.run_date
),
fallback as (
  select w.*
  from public.mtf_cedear_work w,meta m
  where m.fallback_date is not null
    and w.run_date=m.fallback_date
    and w.eligible_liquid=true
),
checks as (
  select 'snapshot_rows_exist' test,
         (select total from meta)>0 ok
  union all
  select 'basis_known',
         (select basis from meta) in ('BYMA_CURRENT_TURNOVER','BYMA_LAST_VALID_UNIVERSE_FALLBACK')
  union all
  select 'basis_matches_feed_validity',
         (select (current_valid and basis='BYMA_CURRENT_TURNOVER')
                  or (not current_valid and basis='BYMA_LAST_VALID_UNIVERSE_FALLBACK') from meta)
  union all
  select 'rule_matches_basis',
         (select (basis='BYMA_CURRENT_TURNOVER' and universe_rule='BYMA_CURRENT_TURNOVER_CUM90_SPREAD2')
                  or (basis='BYMA_LAST_VALID_UNIVERSE_FALLBACK' and universe_rule='FALLBACK_LAST_VALID_BYMA_UNIVERSE') from meta)
  union all
  select 'fallback_date_semantics',
         (select (current_valid and fallback_date is null)
                  or (not current_valid and fallback_date is not null and fallback_date<run_date) from meta)
  union all
  select 'eligible_count_matches_snapshot',
         (select count(*) from cur where eligible_liquid)=(select total from meta)
  union all
  select 'fallback_set_consistent',
         (select current_valid from meta)
         or not exists(
           (select symbol from cur where eligible_liquid except select symbol from fallback)
           union all
           (select symbol from fallback except select symbol from cur where eligible_liquid)
         )
  union all
  select 'fallback_rank_consistent',
         (select current_valid from meta)
         or not exists(
           select 1
           from cur c join fallback f using(symbol)
           where c.eligible_liquid and c.liquidity_rank is distinct from f.liquidity_rank
         )
)
select test,ok from checks order by test;
