-- ADR-OB-v1.0 implementation certification metadata.
-- This certifies implementation/QA only. It does NOT certify profitability
-- and does NOT claim a real-trade end-to-end cycle before the first live signal occurs.
update public.mtf_strategy_registry
set rules = coalesce(rules,'{}'::jsonb) || jsonb_build_object(
  'certification',jsonb_build_object(
    'status','IMPLEMENTATION_CERTIFIED',
    'certificate','ADR_CERT_V1',
    'certified_at',now(),
    'deterministic_selftests','8/8',
    'production_db_invariants','21/21',
    'frontend_syntax','PASS',
    'api_syntax','PASS',
    'runtime_snapshot','14/14 READY',
    'production_endpoints','HTTP 200',
    'watcher_runtime','HTTP 200',
    'cron','ACTIVE',
    'statistics_reconciliation','OK',
    'first_real_trade_e2e','PENDING_FIRST_SIGNAL',
    'economic_performance','NOT_CERTIFIED'
  )
)
where version='ADR-OB-v1.0';
