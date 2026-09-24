-- v3.5.20 reconciliation regression checks (read-only)
-- Expected: every row passed=true.

with checks as (
  select 'one_active_epoch'::text check_name,
         (select count(*)=1 from public.mtf_stats_epochs where active) passed
  union all
  select 'restored_user_epoch_8',
         coalesce((select id=8 from public.mtf_stats_epochs where active limit 1),false)
  union all
  select 'hd_prior_tracking_preserved',
         exists(select 1 from public.mtf_signals where id=75 and source='FORWARD'
                and status in ('OPEN','TP1','TP2')
                and coalesce((context->>'stats_epoch_excluded')::boolean,false))
  union all
  select 'pamp_prior_tracking_preserved',
         exists(select 1 from public.mtf_signals where id=77 and source='FORWARD'
                and status in ('OPEN','TP1','TP2')
                and coalesce((context->>'stats_epoch_excluded')::boolean,false))
  union all
  select 'reset_duplicates_not_forward',
         not exists(select 1 from public.mtf_signals where id in (79,80) and source='FORWARD')
  union all
  select 'stable_forward_setup_rank_unique',
         exists(select 1 from pg_indexes where schemaname='public'
                and indexname='mtf_signals_forward_setup_rank_stable_uq')
  union all
  select 'no_forward_setup_rank_duplicates',
         not exists(
           select 1 from public.mtf_signals
           where source='FORWARD' and context ? 'setup_id' and context ? 'entry_rank'
           group by market,symbol,context->>'setup_id',context->>'entry_rank'
           having count(*)>1
         )
  union all
  select 'invalidated_history_retained',
         (select count(*)>=6 from public.mtf_signals_invalidated_archive
          where strategy_version='OB-LADDER-v3.5')
  union all
  select 'lost_ltc_stop_recovered',
         exists(select 1 from public.mtf_recovered_events
                where symbol='LTC' and event_type='SL' and entry=65.53 and level=66.74397035)
  union all
  select 'delete_guards_present',
         (select count(*)=4 from pg_trigger
          where not tgisinternal and tgname in (
            'mtf_no_delete_signals','mtf_no_delete_alert_events',
            'mtf_no_delete_delivery_ledger','mtf_no_delete_stats_epochs'))
  union all
  select 'delivery_ledger_no_service_delete',
         not exists(
           select 1 from information_schema.role_table_grants
           where table_schema='public' and table_name='mtf_alert_delivery_ledger'
             and grantee='service_role' and privilege_type in ('DELETE','UPDATE','TRUNCATE')
         )
  union all
  select 'stats_reconciled',
         coalesce(public.mtf_stats_snapshot()->'reconciliation'->>'status','')='OK'
  union all
  select 'overlay_counts_consistent',
         (public.mtf_stats_audit_overlay()->'tracking_summary'->>'open_total')::int =
         (public.mtf_stats_snapshot()->'reconciliation'->>'current_open_setups')::int
  union all
  select 'crypto_closed_1m_entry_only',
         not exists(
           select 1 from public.mtf_signals
           where strategy_version='OB-LADDER-v3.5' and market='crypto' and source='FORWARD'
             and context->'trigger_bar'->>'t' is not null
             and created_at < to_timestamp(((context->'trigger_bar'->>'t')::bigint + 60000)/1000.0)
         )
)
select * from checks order by check_name;
