-- Guard against causal references created by older crypto strategy builds.
update public.mtf_analyzer_state
set state = coalesce(state,'{}'::jsonb) - 'lastEval',
    updated_at = now()
where market='crypto' and timeframe='1h';

update public.mtf_state
set meta = jsonb_build_object(
      'strategy_version','OB-LADDER-v3.7.2',
      'engine','MTF_PULLBACK_CONFIRM_V3_7_2',
      'generated_at',now(),
      'baseline',true,
      'snapshot','[]'::jsonb
    ),
    last_processed_at=now(),
    last_run_at=now(),
    updated_at=now()
where market in ('crypto_structure','crypto_live');

update public.mtf_state
set meta=jsonb_build_object(
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
