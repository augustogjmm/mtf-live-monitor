-- v3.6.3 regression invariants. Every row must return ok=true.
with operational as (
  select s.*,coalesce(nullif(context->>'setup_id',''),'legacy:'||id::text) setup_id
  from public.mtf_signals s
  where strategy_version in ('OB-LADDER-v3.5','OB-LADDER-v3.6')
    and source in ('FORWARD','MIGRATED_STRICT')
    and (
      (strategy_version='OB-LADDER-v3.5' and status in ('OPEN','TP1','TP2'))
      or (strategy_version='OB-LADDER-v3.6' and status='OPEN')
    )
)
select 'current_build_is_v36' test,
       public.mtf_system_status()->'build'->>'strategy_version'='OB-LADDER-v3.6' ok
union all
select 'no_cross_version_active_asset',
       not exists(
         select market,symbol from operational
         group by market,symbol
         having count(distinct strategy_version)>1
       )
union all
select 'crypto_legacy_active_present_in_structure',
       not exists(
         select 1
         from (select distinct symbol from operational where market='crypto' and strategy_version='OB-LADDER-v3.5') o
         where not exists(
           select 1 from jsonb_array_elements(
             (select meta->'snapshot' from public.mtf_state where market='crypto_structure')
           ) x where x->>'symbol'=o.symbol
         )
       )
union all
select 'regulated_runtime_is_v36',
       coalesce((select meta->>'strategy_version' from public.mtf_state where market='regulated_live'),'')='OB-LADDER-v3.6'
union all
select 'regulated_runtime_engine_is_v36',
       coalesce((select meta->>'engine' from public.mtf_state where market='regulated_live'),'')='ANALYZER_CANONICAL_V3_6'
union all
select 'cedear_universe_nonzero',
       (select count(*) from public.mtf_cedear_work
        where run_date=(select max(run_date) from public.mtf_cedear_work) and eligible_liquid)>0
union all
select 'retired_hardcoded_cron_removed',
       not exists(select 1 from cron.job where jobid=4 or jobname='mtf_merval_daily')
union all
select 'cedear_prepare_covers_session',
       exists(select 1 from cron.job where jobid=2 and schedule='*/5 13-20 * * 1-5' and active)
union all
select 'v36_crypto_never_contra',
       not exists(
         select 1 from public.mtf_signals
         where strategy_version='OB-LADDER-v3.6' and source='FORWARD' and market='crypto'
           and context->>'trend_relation'='CONTRA_TENDENCIA'
       )
union all
select 'v36_regulated_only_a_favor',
       not exists(
         select 1 from public.mtf_signals
         where strategy_version='OB-LADDER-v3.6' and source='FORWARD' and market in ('cedear','merval')
           and coalesce(context->>'trend_relation','')<>'A_FAVOR'
       )
union all
select 'v36_no_post_tp1_active',
       not exists(
         select 1 from public.mtf_signals
         where strategy_version='OB-LADDER-v3.6' and status in ('TP2','TP3')
       )
union all
select 'stats_reconciliation_ok',
       public.mtf_stats_snapshot()->'reconciliation'->>'status'='OK';
