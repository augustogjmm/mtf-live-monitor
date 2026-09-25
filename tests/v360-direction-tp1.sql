-- v3.6 invariants. Each row must return ok=true.
select 'registry_frozen' test,
       exists(select 1 from public.mtf_strategy_registry where version='OB-LADDER-v3.6' and frozen=true) ok
union all
select 'crypto_no_contra_entries',
       not exists(
         select 1 from public.mtf_signals
         where strategy_version='OB-LADDER-v3.6' and source='FORWARD'
           and market='crypto' and context->>'trend_relation'='CONTRA_TENDENCIA'
       )
union all
select 'regulated_only_a_favor',
       not exists(
         select 1 from public.mtf_signals
         where strategy_version='OB-LADDER-v3.6' and source='FORWARD'
           and market in ('cedear','merval')
           and coalesce(context->>'trend_relation','')<>'A_FAVOR'
       )
union all
select 'regulated_no_automatic_stop_policy',
       not exists(
         select 1 from public.mtf_signals
         where strategy_version='OB-LADDER-v3.6' and source='FORWARD'
           and market in ('cedear','merval')
           and coalesce(context->>'stop_policy','')<>'NONE'
       )
union all
select 'no_post_tp1_operational_status',
       not exists(
         select 1 from public.mtf_signals
         where strategy_version='OB-LADDER-v3.6' and status in ('TP2','TP3')
       )
union all
select 'tp1_is_closed',
       not exists(
         select 1 from public.mtf_signals
         where strategy_version='OB-LADDER-v3.6' and status='TP1' and closed_at is null
       )
union all
select 'stats_open_matches_open_setups',
       coalesce((public.mtf_stats_snapshot()->'summary'->>'open')::int,0)
       =coalesce((public.mtf_stats_snapshot()->'reconciliation'->>'current_open_setups')::int,0)
union all
select 'stats_reconciliation_ok',
       public.mtf_stats_snapshot()->'reconciliation'->>'status'='OK';
