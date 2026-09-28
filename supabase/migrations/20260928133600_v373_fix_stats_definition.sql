-- v3.7.3 metadata correction found during production verification.
do $$
declare d text;
begin
  select pg_get_functiondef('public.mtf_stats_snapshot()'::regprocedure) into d;
  d:=replace(
    d,
    'Crypto: v3.7.2 strict 1H confirmed pullback. Regulated: v3.6 unchanged. TP1=success; structural SL=failure; BE and ambiguous are neutral/excluded from hit/fail denominator.',
    'Crypto: v3.7.3 confirmed 1H pullback; A_FAVOR/RANGO allowed and CONTRA_TENDENCIA blocked; 1H structure, 2-of-3 momentum, confirmed rejection and RR>=1.8 retained; EMA context-only. Regulated: v3.6 unchanged. TP1=success; structural SL=failure; BE and ambiguous are neutral/excluded from hit/fail denominator.'
  );
  execute d;
end $$;
