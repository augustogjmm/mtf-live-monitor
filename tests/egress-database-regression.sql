-- Run on one connection, inserting the migration at the marker. All writes roll back.
BEGIN ISOLATION LEVEL REPEATABLE READ;
CREATE TEMP TABLE egress_before AS SELECT * FROM public.mtf_state WHERE market='regulated_live';
-- APPLY_COMPACT_EGRESS_MIGRATION
DO $test$
DECLARE state jsonb; original jsonb; next_state jsonb; actual jsonb; inputs jsonb;
  first_row jsonb; changed_row jsonb; asset_key text; row_record record;
  source_row jsonb; monitor_row jsonb; field text; timeframe text;
BEGIN
  SELECT to_jsonb(b) INTO original FROM egress_before b;
  state := public.mtf_regulated_worker_state();
  IF jsonb_array_length(state->'meta'->'snapshot') <> jsonb_array_length(original->'meta'->'snapshot') THEN
    RAISE EXCEPTION 'Worker projection lost assets';
  END IF;
  next_state := original || jsonb_build_object('meta',state->'meta');
  PERFORM public.mtf_save_regulated_worker_state(next_state,ARRAY[]::text[]);
  SELECT to_jsonb(s) INTO actual FROM public.mtf_state s WHERE market='regulated_live';
  IF actual IS DISTINCT FROM original THEN RAISE EXCEPTION 'Compact merge changed full state'; END IF;
  first_row := original->'meta'->'snapshot'->0;
  asset_key := (first_row->>'market')||':'||(first_row->>'symbol');
  changed_row := jsonb_build_object('market',first_row->'market','symbol',first_row->'symbol',
    'ready',false,'state','NO_ANALYSIS','reason','TRANSACTIONAL_TEST');
  next_state := jsonb_set(next_state,'{meta,snapshot,0}',changed_row);
  PERFORM public.mtf_save_regulated_worker_state(next_state,ARRAY[asset_key]);
  SELECT meta->'snapshot' INTO actual FROM public.mtf_state WHERE market='regulated_live';
  IF actual IS DISTINCT FROM jsonb_set(original->'meta'->'snapshot','{0}',changed_row) THEN
    RAISE EXCEPTION 'Replacement kept obsolete fields or modified other assets';
  END IF;
  -- Restore the original full row within this transaction before input comparisons.
  PERFORM public.mtf_save_regulated_worker_state(original,
    ARRAY(SELECT (item->>'market')||':'||(item->>'symbol')
      FROM jsonb_array_elements(original->'meta'->'snapshot') AS item));
  inputs := public.mtf_prealert_inputs();
  FOR row_record IN SELECT * FROM public.mtf_state WHERE market IN ('crypto_live','regulated_live') LOOP
    IF (SELECT item->'meta'->'snapshot' FROM jsonb_array_elements(inputs) item
        WHERE item->>'market'=row_record.market) IS DISTINCT FROM
      (SELECT coalesce(jsonb_agg(item ORDER BY ordinal),'[]'::jsonb)
       FROM jsonb_array_elements(row_record.meta->'snapshot') WITH ORDINALITY entries(item,ordinal)
       WHERE item->>'state'=CASE row_record.market WHEN 'crypto_live' THEN 'NEAR' ELSE 'IN_ZONE' END) THEN
      RAISE EXCEPTION 'Prealert candidate projection differs';
    END IF;
  END LOOP;
  FOR row_record IN SELECT * FROM public.mtf_state WHERE market IN ('crypto_live','regulated_live','adr_live') LOOP
    IF (SELECT item->'meta'->'snapshot' FROM jsonb_array_elements(public.mtf_stats_price_inputs()) item
        WHERE item->>'market'=row_record.market) IS DISTINCT FROM
      (SELECT coalesce(jsonb_agg((SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
        FROM jsonb_each(item) WHERE key IN ('market','symbol','name','price')) ORDER BY ordinal),'[]'::jsonb)
       FROM jsonb_array_elements(row_record.meta->'snapshot') WITH ORDINALITY entries(item,ordinal)) THEN
      RAISE EXCEPTION 'Price or name changed in statistics projection';
    END IF;
  END LOOP;
  FOR source_row IN SELECT item FROM public.mtf_state s,
    jsonb_array_elements(s.meta->'snapshot') item
    WHERE s.market IN ('crypto_live','crypto_structure','regulated_live','adr_live') LOOP
    monitor_row := public.mtf_monitor_row(source_row);
    FOREACH field IN ARRAY ARRAY['market','symbol','pair','name','price','t','updated_at',
      'ready','state','serverState','stale_data','stops'] LOOP
      IF monitor_row->field IS DISTINCT FROM source_row->field THEN
        RAISE EXCEPTION 'Displayed field changed: %',field;
      END IF;
    END LOOP;
    FOREACH field IN ARRAY ARRAY['trend','rsi14','macd','signal','atr14','volumeRatio'] LOOP
      IF monitor_row->'context'->field IS DISTINCT FROM source_row->'context'->field THEN
        RAISE EXCEPTION 'Displayed indicator changed: %',field;
      END IF;
    END LOOP;
    FOREACH timeframe IN ARRAY ARRAY['h1','h4','d1','w1'] LOOP
      IF coalesce(monitor_row->'macroContext'->timeframe->'trend','null'::jsonb)
        IS DISTINCT FROM coalesce(source_row->'macroContext'->timeframe->'trend','null'::jsonb) THEN
        RAISE EXCEPTION 'Macro trend changed: %',timeframe;
      END IF;
    END LOOP;
    FOREACH field IN ARRAY ARRAY['below','above'] LOOP
      IF (SELECT coalesce(jsonb_agg(level->'point' ORDER BY ordinal),'[]'::jsonb)
          FROM jsonb_array_elements(monitor_row->'ladder'->field) WITH ORDINALITY levels(level,ordinal))
        IS DISTINCT FROM (SELECT coalesce(jsonb_agg(level->'point' ORDER BY ordinal),'[]'::jsonb)
          FROM jsonb_array_elements(coalesce(source_row->'ladder'->field,'[]'::jsonb)) WITH ORDINALITY levels(level,ordinal)) THEN
        RAISE EXCEPTION 'OB or target levels changed: %',field;
      END IF;
    END LOOP;
  END LOOP;
END;
$test$;
SELECT jsonb_build_object('worker_before',octet_length(meta::text),
  'worker_after',octet_length(public.mtf_regulated_worker_state()::text),
  'prealert_before',(SELECT sum(octet_length(meta::text)) FROM public.mtf_state
    WHERE market IN ('crypto_live','crypto_structure','regulated_live','prealert_live')),
  'prealert_after',octet_length(public.mtf_prealert_inputs()::text),
  'prices_after',octet_length(public.mtf_stats_price_inputs()::text)) AS measurements
FROM egress_before;
ROLLBACK;
SELECT 'PASS: full state preserved, replacement semantics, candidates and prices; ALL_WRITES_ROLLED_BACK' AS result;
