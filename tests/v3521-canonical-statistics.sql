-- v3.5.21 canonical statistics regression checks
with raw as (
  select *,coalesce(nullif(context->>'setup_id',''),'legacy:'||id::text) setup_id
  from public.mtf_signals
  where strategy_version='OB-LADDER-v3.5'
    and source='FORWARD'
    and coalesce(context->>'trigger_basis','') in (
      'entry_only_when_1m_range_crosses_exact_OB_center_line',
      'entry_only_when_intraday_range_crosses_exact_OB_center_line'
    )
),
setup_states as (
  select setup_id,
    case
      when bool_or(status='AMBIGUOUS') then 'AMBIGUOUS'
      when bool_or(status='SL') then 'SL'
      when bool_or(status='TP3') then 'TP3'
      when bool_or(status='TP2') then 'TP2'
      when bool_or(status='TP1') then 'TP1'
      else 'OPEN'
    end status
  from raw group by setup_id
),
snap as (select public.mtf_stats_snapshot() j),
checks as (
  select 'stats_total_matches_canonical_setups' check_name,
    ((select (j->'summary'->>'total')::int from snap)=(select count(*) from setup_states)) passed
  union all
  select 'stats_open_matches_canonical_open',
    ((select (j->'summary'->>'open')::int from snap)=(select count(*) from setup_states where status in ('OPEN','TP1','TP2')))
  union all
  select 'stats_closed_matches_canonical_closed',
    ((select (j->'summary'->>'closed')::int from snap)=(select count(*) from setup_states where status in ('TP3','SL','AMBIGUOUS')))
  union all
  select 'reconciliation_ok',
    ((select j->'reconciliation'->>'status' from snap)='OK')
  union all
  select 'no_valid_signal_without_telegram',
    ((select (j->'reconciliation'->>'valid_entries_without_telegram')::int from snap)=0)
  union all
  select 'no_forward_setup_rank_duplicates',
    not exists(
      select 1 from raw
      where context ? 'setup_id' and context ? 'entry_rank'
      group by market,symbol,context->>'setup_id',context->>'entry_rank'
      having count(*)>1
    )
  union all
  select 'invalidated_not_in_canonical_stats',
    not exists(
      select 1
      from public.mtf_signals_invalidated_archive a
      join raw r on r.id=a.id
    )
  union all
  select 'archived_duplicates_not_in_canonical_stats',
    not exists(select 1 from raw where source<>'FORWARD')
)
select * from checks order by check_name;
