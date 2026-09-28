-- ADR-OB-v1.0
-- Isolated ADR strategy. Crypto v3.7.3 and CEDEAR v3.6 remain unchanged.
insert into public.mtf_strategy_registry(version,activated_at,frozen,rules)
values(
  'ADR-OB-v1.0',
  now(),
  true,
  jsonb_build_object(
    'scope','merval_adr_usd',
    'engine','ADR_DW_15M_RECOVERY_V1',
    'forward_only',true,
    'direction','LONG_ONLY',
    'structure_timeframe','1D',
    'context_timeframe','1W',
    'context_rule','Daily ALCISTA AND Weekly ALCISTA',
    'execution_timeframe','15m closed bars',
    'entry_confirmation','15m overlaps active bullish Daily OB, crosses OB center, closes back above center, bullish candle, lower wick >= 20%, max chase <= OB top + 0.25 ATR14',
    'target','nearest active bearish Daily OB above confirmed entry',
    'technical_invalidation','selected bullish OB bottom - 0.25 ATR14',
    'stop_execution','NONE; invalidation is analytical/reference only',
    'minimum_rr',1.8,
    'exit','TP1 final',
    'positioning','one active ADR operation per asset',
    'intraday_role','execution confirmation only; no lower-timeframe trend filter',
    'market_guard','USA open for entry/monitoring',
    'data_source','Yahoo Finance ADR USD'
  )
)
on conflict(version) do update
set activated_at=excluded.activated_at,frozen=excluded.frozen,rules=excluded.rules;

do $$
declare d text;
begin
  select pg_get_functiondef('public.mtf_stats_snapshot()'::regprocedure) into d;

  d:=replace(
    d,
    $$or (
        s.market in ('cedear','merval')
        and s.strategy_version='OB-LADDER-v3.6'
      )$$,
    $$or (
        s.market='cedear'
        and s.strategy_version='OB-LADDER-v3.6'
      )
      or (
        s.market='merval'
        and s.strategy_version='ADR-OB-v1.0'
      )$$
  );

  d:=replace(
    d,
    $$a.strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7.3')$$,
    $$a.strategy_version in ('OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')$$
  );

  d:=replace(
    d,
    $$'v36_regulated',count(*) filter(where market in ('cedear','merval') and strategy_version='OB-LADDER-v3.6')$$,
    $$'v36_regulated',count(*) filter(where market='cedear' and strategy_version='OB-LADDER-v3.6'),
    'adr_v1',count(*) filter(where market='merval' and strategy_version='ADR-OB-v1.0')$$
  );

  d:=replace(
    d,
    $$'collection_label','v3.7.3 crypto + v3.6 regulados · clean forward statistics'$$,
    $$'collection_label','v3.7.3 crypto + v3.6 CEDEAR + ADR-OB-v1.0 · clean forward statistics'$$
  );

  d:=replace(
    d,
    $$'definition','Crypto: v3.7.3 confirmed 1H pullback; A_FAVOR/RANGO allowed and CONTRA_TENDENCIA blocked; 1H structure, 2-of-3 momentum, confirmed rejection and RR>=1.8 retained; EMA context-only. Regulated: v3.6 unchanged. TP1=success; structural SL=failure; BE and ambiguous are neutral/excluded from hit/fail denominator.'$$,
    $$'definition','Crypto: v3.7.3. CEDEAR: v3.6. ADR: ADR-OB-v1.0 requires Daily+Weekly ALCISTA, confirmed closed-15m recovery from a Daily bullish OB and planned RR>=1.8; technical invalidation is reference-only, no automatic stop; TP1 is final success.'$$
  );

  execute d;
end $$;

grant execute on function public.mtf_stats_snapshot() to anon, authenticated, service_role;
