-- v3.6.4 clean measurement reset
-- Preserve code, strategy definitions, detector state, runtime cursors, market prep and Telegram linkage.
-- Remove all operational/statistical history so measurement starts clean from this reset.

truncate table
  public.mtf_alert_delivery_ledger,
  public.mtf_alert_events,
  public.mtf_alert_events_invalidated_archive,
  public.mtf_alert_events_legacy_archive,
  public.mtf_decision_audit,
  public.mtf_decision_audit_legacy_modes_archive,
  public.mtf_recovered_events,
  public.mtf_repair_audit,
  public.mtf_signals,
  public.mtf_signals_invalidated_archive,
  public.mtf_signals_legacy_modes_archive,
  public.mtf_signals_pre_v1_archive,
  public.mtf_signals_v105_dedup_archive,
  public.mtf_stats_epochs
restart identity;

insert into public.mtf_stats_epochs(started_at,label,notes,active)
values (
  now(),
  'OB-LADDER-v3.6 clean start',
  'Full operational/statistical reset requested by user. All new measurements are forward-only from this timestamp.',
  true
);

update public.mtf_alert_config
set activated_at=now(),
    last_watcher_at=now(),
    strategy_version='OB-LADDER-v3.6',
    updated_at=now()
where id=1;

update public.mtf_strategy_registry
set rules = coalesce(rules,'{}'::jsonb) || jsonb_build_object(
  'statistics_epoch','clean-v3.6-2026-09-25',
  'statistics_reset_at',now()
)
where version='OB-LADDER-v3.6';

update public.mtf_state
set meta = jsonb_build_object(
      'keys','[]'::jsonb,
      'crypto_near',0,
      'regulated_zone',0,
      'initialized',false,
      'generated_at',now()
    ),
    last_processed_at=now(),
    last_run_at=now(),
    updated_at=now()
where market='prealert_live';
