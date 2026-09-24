-- v3.5.18 closeout regression checks (read-only)
-- Expected result: every row returns passed = true.

with checks as (
  select
    'signal_geometry'::text check_name,
    not exists (
      select 1 from public.mtf_signals
      where strategy_version='OB-LADDER-v3.5'
        and (
          (direction='LONG' and not(stop<entry and tp1>entry and tp2>=tp1 and tp3>=tp2))
          or
          (direction='SHORT' and not(stop>entry and tp1<entry and tp2<=tp1 and tp3<=tp2))
        )
    ) passed,
    'all v3.5 signals have valid SL/TP geometry'::text detail
  union all
  select
    'signal_excursions',
    not exists (
      select 1 from public.mtf_signals
      where strategy_version='OB-LADDER-v3.5' and (best_r<0 or worst_r>0)
    ),
    'MFE >= 0 and MAE <= 0'
  union all
  select
    'setup_rank_context',
    not exists (
      select 1 from public.mtf_signals
      where strategy_version='OB-LADDER-v3.5'
        and (
          not(context ? 'setup_id')
          or not(context ? 'entry_rank')
          or nullif(context->>'setup_id','') is null
          or (context->>'entry_rank')::int not between 1 and 3
        )
    ),
    'every v3.5 leg has setup_id and rank 1..3'
  union all
  select
    'duplicate_setup_rank',
    not exists (
      select 1
      from public.mtf_signals
      where strategy_version='OB-LADDER-v3.5'
      group by market,symbol,context->>'setup_id',context->>'entry_rank'
      having count(*)>1
    ),
    'setup + entry_rank is unique'
  union all
  select
    'legacy_signal_time_dedupe_removed',
    not exists (
      select 1 from pg_indexes
      where schemaname='public' and tablename='mtf_signals'
        and indexname='mtf_signals_single_strategy_dedupe_idx'
    ),
    'E1/E2/E3 may share a signal minute'
  union all
  select
    'tp3_event_allowed',
    exists (
      select 1 from pg_constraint
      where conrelid='public.mtf_alert_events'::regclass
        and conname='mtf_alert_events_event_type_check'
        and pg_get_constraintdef(oid) like '%TP3%'
    ),
    'alert event constraint accepts TP3'
  union all
  select
    'health_payload_compact',
    pg_column_size(public.mtf_system_status()) < 65536,
    'system status payload stays below 64 KiB'
  union all
  select
    'strategy_contract_frozen',
    coalesce((select frozen from public.mtf_strategy_registry where version='OB-LADDER-v3.5'),false),
    'v3.5 strategy registry remains frozen'
)
select * from checks order by check_name;
