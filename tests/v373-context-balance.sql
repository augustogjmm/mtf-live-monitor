-- v3.7.3 regression/invariant checks. Every row must return ok=true.
with structure_snap as (
  select x
  from public.mtf_state s, jsonb_array_elements(s.meta->'snapshot') x
  where s.market='crypto_structure'
),
gates as (
  select x->>'symbol' symbol,'LONG' direction,x->'eligibility'->'LONG' gate from structure_snap
  union all
  select x->>'symbol','SHORT',x->'eligibility'->'SHORT' from structure_snap
)
select 'registry_frozen_v373' test,
       exists(select 1 from public.mtf_strategy_registry where version='OB-LADDER-v3.7.3' and frozen=true) ok
union all
select 'active_epoch_v373',
       exists(select 1 from public.mtf_stats_epochs where active=true and label='OB-LADDER-v3.7.3 clean start')
union all
select 'structure_runtime_v373',
       coalesce((select meta->>'strategy_version' from public.mtf_state where market='crypto_structure'),'')='OB-LADDER-v3.7.3'
union all
select 'live_runtime_v373',
       coalesce((select meta->>'strategy_version' from public.mtf_state where market='crypto_live'),'')='OB-LADDER-v3.7.3'
union all
select 'engine_v373',
       coalesce((select meta->>'engine' from public.mtf_state where market='crypto_live'),'')='MTF_PULLBACK_CONFIRM_V3_7_3'
union all
select 'no_eligible_contra',
       not exists(select 1 from gates where coalesce((gate->>'eligible')::boolean,false) and gate->>'relation'='CONTRA_TENDENCIA')
union all
select 'eligible_requires_structure',
       not exists(select 1 from gates where coalesce((gate->>'eligible')::boolean,false) and not coalesce((gate->>'structureOk')::boolean,false))
union all
select 'eligible_requires_2of3_momentum',
       not exists(select 1 from gates where coalesce((gate->>'eligible')::boolean,false) and coalesce((gate->>'momentumScore')::int,0)<2)
union all
select 'range_can_be_eligible',
       exists(select 1 from gates where coalesce((gate->>'eligible')::boolean,false) and gate->>'relation'='RANGO')
union all
select 'ema_is_not_hard_veto',
       exists(select 1 from gates where coalesce((gate->>'eligible')::boolean,false) and not coalesce((gate->>'emaOk')::boolean,false))
union all
select 'funnel_present',
       (select meta ? 'funnel' from public.mtf_state where market='crypto_live')
union all
select 'stats_reconciliation_ok',
       public.mtf_stats_snapshot()->'reconciliation'->>'status'='OK'
union all
select 'no_v373_signal_against_context',
       not exists(
         select 1 from public.mtf_signals
         where strategy_version='OB-LADDER-v3.7.3'
           and source='FORWARD'
           and context->>'trend_relation'='CONTRA_TENDENCIA'
       )
union all
select 'no_v373_signal_bad_structure',
       not exists(
         select 1 from public.mtf_signals
         where strategy_version='OB-LADDER-v3.7.3'
           and source='FORWARD'
           and coalesce((context->'eligibility'->>'structureOk')::boolean,false)=false
       )
union all
select 'no_v373_signal_bad_momentum',
       not exists(
         select 1 from public.mtf_signals
         where strategy_version='OB-LADDER-v3.7.3'
           and source='FORWARD'
           and coalesce((context->'eligibility'->>'momentumScore')::int,0)<2
       );
