-- v3.7.3
-- Minimal crypto adjustment after observing zero entries under v3.7.2.
-- Keep: 1H OB pullback/rejection, 1H structure, 2-of-3 momentum, RR >= 1.8,
-- structural stop and +1R break-even.
-- Change: context blocks only CONTRA_TENDENCIA; A_FAVOR and RANGO are allowed.
-- EMA55/EMA200 remains diagnostic context and is no longer a hard veto.

update public.mtf_stats_epochs set active=false where active=true;

insert into public.mtf_stats_epochs(started_at,label,notes,active)
values(
  now(),
  'OB-LADDER-v3.7.3 clean start',
  'Crypto v3.7.3: A_FAVOR/RANGO allowed, CONTRA_TENDENCIA blocked; 1H structure + 2of3 momentum + confirmed rejection + RR>=1.8 retained. EMA context-only. CEDEAR/ADR remain v3.6.',
  true
);

insert into public.mtf_strategy_registry(version,activated_at,frozen,rules)
values(
  'OB-LADDER-v3.7.3',
  now(),
  true,
  jsonb_build_object(
    'scope','crypto',
    'engine','MTF_PULLBACK_CONFIRM_V3_7_3',
    'forward_only',true,
    'operational_timeframe','1H',
    'context_timeframes',jsonb_build_array('1H','4H','1D'),
    'context_rule','majority context across 1H/4H/Daily; block only CONTRA_TENDENCIA; allow A_FAVOR and RANGO',
    'ema_filter','EMA55/EMA200 and slope remain diagnostic context only; never a hard veto',
    'structure_filter','1H market structure must match direction',
    'momentum','at least 2 of 3: RSI14 >/< 50; MACD signal + histogram improving; volume >= 20-bar average',
    'pullback','closed 1H candle overlaps an Order Block active before the confirmation candle, crosses center and rejects with >=20% directional wick',
    'causality','entry OB and target ladder frozen from detector state immediately before confirmation candle',
    'minimum_rr',1.8,
    'target','nearest opposite active Order Block satisfying RR >= 1.8',
    'stop','far edge of selected Order Block + 0.30 ATR14',
    'protection','after a closed 1m bar reaches +1R, active stop moves to break-even for following bars',
    'same_bar_uncertainty','if 1R and initial stop occur in same 1m bar, result is AMBIGUOUS',
    'positioning','one open crypto setup per asset',
    'regulated_strategy','OB-LADDER-v3.6 unchanged',
    'funnel','assets -> near/zone -> context allowed -> structure -> momentum -> confirmed rejection -> RR -> entry'
  )
)
on conflict(version) do update
set activated_at=excluded.activated_at,frozen=excluded.frozen,rules=excluded.rules;

update public.mtf_alert_config
set strategy_version='OB-LADDER-v3.7.3',
    activated_at=now(),
    last_watcher_at=now(),
    updated_at=now()
where id=1;

update public.mtf_state
set meta = jsonb_build_object(
      'keys','[]'::jsonb,
      'crypto_near',0,
      'regulated_zone',0,
      'initialized',false,
      'generated_at',now()
    ),
    last_processed_at=now(),last_run_at=now(),updated_at=now()
where market='prealert_live';

do $$
declare d text;
begin
  select pg_get_functiondef('public.mtf_stats_snapshot()'::regprocedure) into d;
  d:=replace(d,'OB-LADDER-v3.7.2','OB-LADDER-v3.7.3');
  d:=replace(d,'v3.7.2 crypto + v3.6 regulados','v3.7.3 crypto + v3.6 regulados');
  d:=replace(d,'Crypto: v3.7.3 strict 1H confirmed pullback.','Crypto: v3.7.3 confirmed 1H pullback; A_FAVOR/RANGO allowed, CONTRA_TENDENCIA blocked; structure, momentum, rejection and RR retained.');
  execute d;

  select pg_get_functiondef('public.mtf_audit_status()'::regprocedure) into d;
  d:=replace(d,'OB-LADDER-v3.7.2','OB-LADDER-v3.7.3');
  d:=replace(d,'3.7.2','3.7.3');
  execute d;

  select pg_get_functiondef('public.mtf_system_status()'::regprocedure) into d;
  d:=replace(d,'OB-LADDER-v3.7.2','OB-LADDER-v3.7.3');
  d:=replace(d,'3.7.2','3.7.3');
  execute d;
end $$;

grant execute on function public.mtf_stats_snapshot() to anon, authenticated, service_role;
grant execute on function public.mtf_audit_status() to anon, authenticated, service_role;
grant execute on function public.mtf_system_status() to anon, authenticated, service_role;
