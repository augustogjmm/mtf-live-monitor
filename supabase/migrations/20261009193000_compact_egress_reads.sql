-- Keep full analysis in PostgreSQL; transfer only each worker's input fields.
CREATE OR REPLACE FUNCTION public.mtf_regulated_worker_state()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('last_run_at',last_run_at,'meta',
    (meta - 'snapshot') || jsonb_build_object('snapshot',coalesce((
      SELECT jsonb_agg((SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
        FROM jsonb_each(item) WHERE key = ANY(ARRAY[
          'market','symbol','ready','state','actionable','name','last_15m_close',
          'retry_count','t'])) ORDER BY ordinal)
      FROM jsonb_array_elements(coalesce(meta->'snapshot','[]'::jsonb))
        WITH ORDINALITY AS entries(item,ordinal)
    ),'[]'::jsonb)))
  FROM public.mtf_state WHERE market='regulated_live';
$$;

CREATE OR REPLACE FUNCTION public.mtf_save_regulated_worker_state(
  p_state jsonb, p_replaced text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE prior jsonb; merged jsonb; new_meta jsonb;
BEGIN
  IF p_state->>'market' IS DISTINCT FROM 'regulated_live'
    OR jsonb_typeof(p_state->'meta'->'snapshot') IS DISTINCT FROM 'array'
    OR p_replaced IS NULL THEN
    RAISE EXCEPTION 'Invalid regulated worker state';
  END IF;
  SELECT meta INTO prior FROM public.mtf_state
    WHERE market='regulated_live' FOR UPDATE;
  WITH old_rows AS (
    SELECT (item->>'market')||':'||(item->>'symbol') AS asset_key,item
    FROM jsonb_array_elements(coalesce(prior->'snapshot','[]'::jsonb)) AS item
  ), next_rows AS (
    SELECT item,ordinal,(item->>'market')||':'||(item->>'symbol') AS asset_key
    FROM jsonb_array_elements(p_state->'meta'->'snapshot')
      WITH ORDINALITY AS entries(item,ordinal)
  )
  SELECT coalesce(jsonb_agg(CASE WHEN n.asset_key=ANY(p_replaced)
    THEN n.item ELSE coalesce(o.item,'{}'::jsonb)||n.item END ORDER BY n.ordinal),'[]'::jsonb)
  INTO merged FROM next_rows n LEFT JOIN old_rows o USING(asset_key);
  new_meta := jsonb_set(p_state->'meta','{snapshot}',merged);
  INSERT INTO public.mtf_state(market,last_processed_at,last_run_at,meta,updated_at)
  VALUES ('regulated_live',(p_state->>'last_processed_at')::timestamptz,
    (p_state->>'last_run_at')::timestamptz,new_meta,(p_state->>'updated_at')::timestamptz)
  ON CONFLICT (market) DO UPDATE SET last_processed_at=EXCLUDED.last_processed_at,
    last_run_at=EXCLUDED.last_run_at,meta=EXCLUDED.meta,updated_at=EXCLUDED.updated_at;
  RETURN jsonb_build_object('saved',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.mtf_prealert_inputs()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  WITH candidates AS (
    SELECT market,last_run_at,meta,
      CASE market WHEN 'crypto_live' THEN 'NEAR' ELSE 'IN_ZONE' END AS needed_state
    FROM public.mtf_state WHERE market IN ('crypto_live','regulated_live')
  ), filtered AS (
    SELECT market,last_run_at,jsonb_build_object('snapshot',coalesce((
      SELECT jsonb_agg(item ORDER BY ordinal)
      FROM jsonb_array_elements(coalesce(meta->'snapshot','[]'::jsonb))
        WITH ORDINALITY AS entries(item,ordinal)
      WHERE item->>'state'=needed_state
    ),'[]'::jsonb)) AS meta FROM candidates
  ), structure AS (
    SELECT market,last_run_at,jsonb_build_object('snapshot',coalesce((
      SELECT jsonb_agg(item ORDER BY ordinal)
      FROM jsonb_array_elements(coalesce(s.meta->'snapshot','[]'::jsonb))
        WITH ORDINALITY AS entries(item,ordinal)
      WHERE item->>'symbol' IN (
        SELECT live->>'symbol' FROM filtered f,
          jsonb_array_elements(f.meta->'snapshot') AS live WHERE f.market='crypto_live'
      )
    ),'[]'::jsonb)) AS meta FROM public.mtf_state s WHERE market='crypto_structure'
  ), inputs AS (
    SELECT * FROM filtered UNION ALL SELECT * FROM structure
    UNION ALL SELECT market,last_run_at,meta FROM public.mtf_state WHERE market='prealert_live'
  ) SELECT coalesce(jsonb_agg(to_jsonb(inputs)),'[]'::jsonb) FROM inputs;
$$;

CREATE OR REPLACE FUNCTION public.mtf_stats_price_inputs()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('market',market,'meta',
    jsonb_build_object('snapshot',coalesce((
      SELECT jsonb_agg((SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
        FROM jsonb_each(item) WHERE key=ANY(ARRAY['market','symbol','name','price'])) ORDER BY ordinal)
      FROM jsonb_array_elements(coalesce(meta->'snapshot','[]'::jsonb))
        WITH ORDINALITY AS entries(item,ordinal)
    ),'[]'::jsonb)))),'[]'::jsonb)
  FROM public.mtf_state WHERE market IN ('regulated_live','adr_live','crypto_live');
$$;

REVOKE ALL ON FUNCTION public.mtf_regulated_worker_state(),
  public.mtf_save_regulated_worker_state(jsonb,text[]),public.mtf_prealert_inputs(),
  public.mtf_stats_price_inputs() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mtf_regulated_worker_state(),
  public.mtf_save_regulated_worker_state(jsonb,text[]),public.mtf_prealert_inputs(),
  public.mtf_stats_price_inputs() TO service_role;
GRANT EXECUTE ON FUNCTION public.mtf_stats_price_inputs() TO anon,authenticated;
-- Public monitor projection retains displayed prices, clocks, levels and indicators.
CREATE OR REPLACE FUNCTION public.mtf_monitor_row(p_row jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(p_row)
    WHERE key=ANY(ARRAY['market','symbol','pair','name','price','t','updated_at',
      'ready','state','serverState','stale_data','stops'])),'{}'::jsonb)
  || jsonb_build_object(
    'context',coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(coalesce(p_row->'context','{}'::jsonb))
      WHERE key=ANY(ARRAY['trend','rsi14','macd','signal','atr14','volumeRatio'])),'{}'::jsonb),
    'macroContext',coalesce((SELECT jsonb_object_agg(key,CASE WHEN key='trend' THEN value
      ELSE jsonb_build_object('trend',value->'trend') END)
      FROM jsonb_each(coalesce(p_row->'macroContext','{}'::jsonb))
      WHERE key=ANY(ARRAY['trend','h1','h4','d1','w1'])),'{}'::jsonb),
    'ladder',jsonb_build_object(
      'below',coalesce((SELECT jsonb_agg((SELECT jsonb_object_agg(key,value)
        FROM jsonb_each(level) WHERE key IN ('rank','point','zone_bottom','zone_top')) ORDER BY ordinal)
        FROM jsonb_array_elements(coalesce(p_row->'ladder'->'below','[]'::jsonb))
          WITH ORDINALITY AS levels(level,ordinal)),'[]'::jsonb),
      'above',coalesce((SELECT jsonb_agg((SELECT jsonb_object_agg(key,value)
        FROM jsonb_each(level) WHERE key IN ('rank','point','zone_bottom','zone_top')) ORDER BY ordinal)
        FROM jsonb_array_elements(coalesce(p_row->'ladder'->'above','[]'::jsonb))
          WITH ORDINALITY AS levels(level,ordinal)),'[]'::jsonb)),
    'proximity',jsonb_build_object('state',p_row->'proximity'->'state',
      'nearest',CASE WHEN jsonb_typeof(p_row->'proximity'->'nearest')='object' THEN
        (SELECT jsonb_object_agg(key,value) FROM jsonb_each(p_row->'proximity'->'nearest')
         WHERE key IN ('rank','point','zone_bottom','zone_top','direction','distanceAtr','distance_atr'))
        ELSE NULL END));
$$;

CREATE OR REPLACE FUNCTION public.mtf_monitor_state(p_market text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('last_run_at',last_run_at,'meta',
    (meta - 'snapshot') || jsonb_build_object('snapshot',coalesce((
      SELECT jsonb_agg(public.mtf_monitor_row(item) ORDER BY ordinal)
      FROM jsonb_array_elements(coalesce(meta->'snapshot','[]'::jsonb))
        WITH ORDINALITY AS entries(item,ordinal)
    ),'[]'::jsonb)))),'[]'::jsonb)
  FROM public.mtf_state WHERE market=p_market
    AND p_market IN ('regulated_live','adr_live','crypto_live','crypto_structure');
$$;
REVOKE ALL ON FUNCTION public.mtf_monitor_row(jsonb),public.mtf_monitor_state(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mtf_monitor_row(jsonb),public.mtf_monitor_state(text)
  TO anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
