-- ADR-OB-v1.0 certification invariants. Every row must return ok=true.
with cert as (select public.mtf_adr_certification_status() j),
snap as (
  select x from public.mtf_state s,jsonb_array_elements(coalesce(s.meta->'snapshot','[]'::jsonb)) x
  where s.market='adr_live'
),
adr_signals as (
  select * from public.mtf_signals
  where strategy_version='ADR-OB-v1.0' and market='merval' and source='FORWARD'
)
select 'registry_exists_and_frozen' test,
       exists(select 1 from public.mtf_strategy_registry where version='ADR-OB-v1.0' and frozen) ok
union all
select 'runtime_version',coalesce((select meta->>'strategy_version'='ADR-OB-v1.0' from public.mtf_state where market='adr_live'),false)
union all
select 'runtime_engine',coalesce((select meta->>'engine'='ADR_DW_15M_RECOVERY_V1' from public.mtf_state where market='adr_live'),false)
union all
select 'snapshot_has_14_adrs',(select count(*) from snap)=14
union all
select 'snapshot_all_ready',(select count(*) from snap where coalesce((x->>'ready')::boolean,false))=14
union all
select 'old_regulated_snapshot_has_no_merval',
       not exists(select 1 from public.mtf_state s,jsonb_array_elements(coalesce(s.meta->'snapshot','[]'::jsonb)) x where s.market='regulated_live' and x->>'market'='merval')
union all
select 'adr_cron_active',exists(select 1 from cron.job where jobname='mtf_adr_live' and active and schedule='*/5 * * * 1-5')
union all
select 'one_open_db_guard_exists',exists(select 1 from pg_indexes where schemaname='public' and tablename='mtf_signals' and indexname='mtf_adr_v1_one_open_asset_uq')
union all
select 'decision_audit_persisting',(select count(*) from public.mtf_decision_audit where strategy_version='ADR-OB-v1.0')>0
union all
select 'decision_audit_no_errors',(select count(*) from public.mtf_decision_audit where strategy_version='ADR-OB-v1.0' and decision='ERROR')=0
union all
select 'all_signals_long',not exists(select 1 from adr_signals where direction<>'LONG')
union all
select 'all_signals_dw_bullish',not exists(select 1 from adr_signals where coalesce(context->'context'->>'trend','')<>'ALCISTA' or coalesce(context->'macro_context'->'w1'->>'trend','')<>'ALCISTA')
union all
select 'all_signals_rr_ge_1_8',not exists(select 1 from adr_signals where coalesce((context->>'planned_rr')::numeric,0)<1.8)
union all
select 'all_signals_confirmed_15m',not exists(select 1 from adr_signals where coalesce(context->>'trigger_basis','')<>'closed_15m_bar_overlaps_daily_bullish_OB_crosses_center_and_closes_back_above_with_bullish_rejection')
union all
select 'no_auto_stop',not exists(select 1 from adr_signals where coalesce(context->>'stop_policy','')<>'REFERENCE_ONLY_NO_AUTO_EXIT')
union all
select 'tp1_final_policy',not exists(select 1 from adr_signals where coalesce(context->>'exit_policy','')<>'TP1_FINAL')
union all
select 'no_post_tp1_states',not exists(select 1 from adr_signals where status in ('TP2','TP3'))
union all
select 'no_duplicate_open_assets',not exists(select 1 from adr_signals where status='OPEN' group by symbol having count(*)>1)
union all
select 'stats_include_adr',position('ADR-OB-v1.0' in public.mtf_stats_snapshot()->>'definition')>0
union all
select 'stats_reconciliation_ok',public.mtf_stats_snapshot()->'reconciliation'->>'status'='OK'
union all
select 'certification_all_checks_true',
       coalesce((select bool_and(value::boolean) from cert,jsonb_each_text(cert.j->'checks')),false);
