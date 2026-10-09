-- Execute only after inspecting production triggers for external effects.
-- All inserted IDs are explicit: identity sequences must not be advanced.
-- The runner must send this complete file on one database connection.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
DO $validation$
DECLARE
  m text;
  v text;
  first_id bigint := -9000000000000000000;
  s text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.mtf_signals WHERE symbol LIKE 'MTF_VALIDATION_%') THEN
    RAISE EXCEPTION 'Validation namespace is already occupied';
  END IF;
  FOREACH m IN ARRAY ARRAY['crypto','cedear','merval'] LOOP
    v := CASE m WHEN 'crypto' THEN 'MACD-OB-v2.0'
      WHEN 'cedear' THEN 'CEDEAR-MACD-OB-v2.0' ELSE 'ADR-OB-v1.0' END;
    s := 'MTF_VALIDATION_' || upper(m);
    first_id := first_id + 10;
    INSERT INTO public.mtf_signals
      (id,market,symbol,direction,signal_time,entry,stop,tp1,tp2,tp3,source,strategy_version,context)
    OVERRIDING SYSTEM VALUE VALUES
      (first_id,m,s,'LONG',now(),100,90,120,125,130,'FORWARD',v,
       jsonb_build_object('setup_id',s||'_first','entry_rank',1));
    BEGIN
      INSERT INTO public.mtf_signals
        (id,market,symbol,direction,signal_time,entry,stop,tp1,tp2,tp3,source,strategy_version,context)
      OVERRIDING SYSTEM VALUE VALUES
        (first_id+1,m,s,'LONG',now()+interval '1 minute',100,90,120,125,130,'FORWARD',v,
         jsonb_build_object('setup_id',s||'_different','entry_rank',1));
      RAISE EXCEPTION 'Concurrent duplicate position was accepted for %',m;
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    IF m IN ('crypto','cedear') THEN
      BEGIN
        INSERT INTO public.mtf_signals
          (id,market,symbol,direction,signal_time,entry,stop,tp1,tp2,tp3,source,strategy_version)
        OVERRIDING SYSTEM VALUE VALUES
          (first_id+4,m,s,'LONG',now(),100,90,120,125,130,'FORWARD',replace(v,'v2.0','v1.0'));
        RAISE EXCEPTION 'A legacy position bypassed the active asset guard';
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END IF;
    BEGIN
      INSERT INTO public.mtf_signals
        (id,market,symbol,direction,signal_time,entry,stop,tp1,tp2,tp3,source,strategy_version)
      OVERRIDING SYSTEM VALUE VALUES
        (first_id+2,m,s||'_RR','LONG',now(),100,90,110,115,120,'FORWARD',v);
      RAISE EXCEPTION 'Insufficient reward/risk was accepted for %',m;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      DELETE FROM public.mtf_signals WHERE id=first_id;
      RAISE EXCEPTION 'Append-only delete was accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'DELETE_BLOCKED:%' THEN RAISE; END IF;
    END;
    UPDATE public.mtf_signals SET stop=entry WHERE id=first_id;
    IF NOT EXISTS(SELECT 1 FROM public.mtf_signals WHERE id=first_id AND stop=entry) THEN
      RAISE EXCEPTION 'Break-even update failed';
    END IF;
    UPDATE public.mtf_signals SET status='TP1',hit1=true,hit1_at=now(),closed_at=now()
      WHERE id=first_id;
    BEGIN
      INSERT INTO public.mtf_signals
        (id,market,symbol,direction,signal_time,entry,stop,tp1,tp2,tp3,source,strategy_version,context)
      OVERRIDING SYSTEM VALUE VALUES
        (first_id+5,m,s,'LONG',now(),100,90,120,125,130,'FORWARD',v,
         jsonb_build_object('setup_id',s||'_first','entry_rank',1));
      RAISE EXCEPTION 'A closed setup was replayed';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    INSERT INTO public.mtf_signals
      (id,market,symbol,direction,signal_time,entry,stop,tp1,tp2,tp3,source,strategy_version,context)
    OVERRIDING SYSTEM VALUE VALUES
      (first_id+3,m,s,'LONG',now()+interval '2 minutes',100,90,120,125,130,'FORWARD',v,
       jsonb_build_object('setup_id',s||'_reopened','entry_rank',1));
  END LOOP;
  INSERT INTO public.mtf_state(market,meta) VALUES('mtf_validation','{"step":1}')
    ON CONFLICT(market) DO UPDATE SET meta=excluded.meta;
  INSERT INTO public.mtf_state(market,meta) VALUES('mtf_validation','{"step":2}')
    ON CONFLICT(market) DO UPDATE SET meta=excluded.meta;
  IF (SELECT meta->>'step' FROM public.mtf_state WHERE market='mtf_validation')<>'2' THEN
    RAISE EXCEPTION 'State upsert failed';
  END IF;
  INSERT INTO public.mtf_analyzer_state(market,symbol,timeframe,state)
    VALUES('crypto','MTF_VALIDATION_DETECTOR','1h','{"cursor":1}')
    ON CONFLICT(market,symbol,timeframe) DO UPDATE SET state=excluded.state;
  INSERT INTO public.mtf_analyzer_state(market,symbol,timeframe,state)
    VALUES('crypto','MTF_VALIDATION_DETECTOR','1h','{"cursor":2}')
    ON CONFLICT(market,symbol,timeframe) DO UPDATE SET state=excluded.state;
  IF (SELECT state->>'cursor' FROM public.mtf_analyzer_state
    WHERE market='crypto' AND symbol='MTF_VALIDATION_DETECTOR' AND timeframe='1h')<>'2' THEN
    RAISE EXCEPTION 'Detector cursor recovery failed';
  END IF;
END
$validation$;
ROLLBACK;
DO $cleanup$
BEGIN
  IF EXISTS(SELECT 1 FROM public.mtf_signals WHERE symbol LIKE 'MTF_VALIDATION_%')
    OR EXISTS(SELECT 1 FROM public.mtf_state WHERE market='mtf_validation')
    OR EXISTS(SELECT 1 FROM public.mtf_analyzer_state WHERE symbol='MTF_VALIDATION_DETECTOR') THEN
    RAISE EXCEPTION 'Rollback did not remove validation data';
  END IF;
END
$cleanup$;
SELECT 'PASS' AS result, 3 AS markets, 'ALL_TEST_WRITES_ROLLED_BACK' AS cleanup;
