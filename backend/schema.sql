CREATE TABLE IF NOT EXISTS mtf_records (
  bucket TEXT NOT NULL,
  record_key TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  PRIMARY KEY (bucket, record_key)
);
CREATE TABLE IF NOT EXISTS mtf_ids (id INTEGER PRIMARY KEY AUTOINCREMENT);
CREATE UNIQUE INDEX IF NOT EXISTS mtf_one_open_asset ON mtf_records (
  json_extract(value,'$.market'), json_extract(value,'$.symbol')
) WHERE bucket='mtf_signals' AND json_extract(value,'$.status')='OPEN'
  AND json_extract(value,'$.source')='FORWARD'
  AND json_extract(value,'$.strategy_version') IN
    ('MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v1.0','CEDEAR-MACD-OB-v2.0','ADR-OB-v1.0');
CREATE UNIQUE INDEX IF NOT EXISTS mtf_once_per_setup ON mtf_records (
  json_extract(value,'$.market'),json_extract(value,'$.symbol'),
  json_extract(value,'$.context.setup_id'),
  json_extract(value,'$.context.entry_rank')
) WHERE bucket='mtf_signals' AND json_extract(value,'$.source')='FORWARD'
  AND json_extract(value,'$.context.setup_id') IS NOT NULL;
CREATE INDEX IF NOT EXISTS mtf_audit_retention ON mtf_records (
  bucket,json_extract(value,'$.evaluated_at')
) WHERE bucket='mtf_decision_audit';
CREATE TRIGGER IF NOT EXISTS mtf_signal_rr_guard BEFORE INSERT ON mtf_records
WHEN NEW.bucket='mtf_signals' AND json_extract(NEW.value,'$.source')='FORWARD'
  AND json_extract(NEW.value,'$.strategy_version') IN ('MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0','ADR-OB-v1.0')
BEGIN
  SELECT CASE WHEN json_extract(NEW.value,'$.direction') IS NULL
    OR json_extract(NEW.value,'$.direction') NOT IN ('LONG','SHORT')
    OR json_extract(NEW.value,'$.entry') IS NULL
    OR json_extract(NEW.value,'$.stop') IS NULL OR json_extract(NEW.value,'$.tp1') IS NULL
    OR json_extract(NEW.value,'$.entry')<=0 OR json_extract(NEW.value,'$.stop')<=0
    OR json_extract(NEW.value,'$.tp1')<=0
    OR abs(json_extract(NEW.value,'$.entry')-json_extract(NEW.value,'$.stop'))=0
    OR abs(json_extract(NEW.value,'$.tp1')-json_extract(NEW.value,'$.entry'))
      < 1.8*abs(json_extract(NEW.value,'$.entry')-json_extract(NEW.value,'$.stop'))-0.00000001
    OR (json_extract(NEW.value,'$.direction')='LONG' AND NOT (
      json_extract(NEW.value,'$.stop')<json_extract(NEW.value,'$.entry') AND
      json_extract(NEW.value,'$.tp1')>json_extract(NEW.value,'$.entry')))
    OR (json_extract(NEW.value,'$.direction')='SHORT' AND NOT (
      json_extract(NEW.value,'$.stop')>json_extract(NEW.value,'$.entry') AND
      json_extract(NEW.value,'$.tp1')<json_extract(NEW.value,'$.entry')))
    THEN RAISE(ABORT,'Invalid forward signal risk/reward') END;
END;
CREATE TRIGGER IF NOT EXISTS mtf_signal_append_only BEFORE DELETE ON mtf_records
WHEN OLD.bucket='mtf_signals' BEGIN SELECT RAISE(ABORT,'Signal history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS mtf_signal_identity_guard BEFORE UPDATE ON mtf_records
WHEN OLD.bucket='mtf_signals' AND (
  json_extract(NEW.value,'$.entry') IS NOT json_extract(OLD.value,'$.entry') OR
  json_extract(NEW.value,'$.tp1') IS NOT json_extract(OLD.value,'$.tp1') OR
  json_extract(NEW.value,'$.direction') IS NOT json_extract(OLD.value,'$.direction') OR
  json_extract(NEW.value,'$.market') IS NOT json_extract(OLD.value,'$.market') OR
  json_extract(NEW.value,'$.symbol') IS NOT json_extract(OLD.value,'$.symbol') OR
  json_extract(NEW.value,'$.strategy_version') IS NOT json_extract(OLD.value,'$.strategy_version') OR
  json_extract(NEW.value,'$.signal_time') IS NOT json_extract(OLD.value,'$.signal_time') OR
  (json_extract(OLD.value,'$.status')<>'OPEN' AND json_extract(NEW.value,'$.status')='OPEN')
) BEGIN SELECT RAISE(ABORT,'Signal identity and terminal lifecycle are immutable'); END;
CREATE TRIGGER IF NOT EXISTS mtf_registry_frozen_guard BEFORE UPDATE ON mtf_records
WHEN OLD.bucket='mtf_strategy_registry' AND json_extract(OLD.value,'$.frozen')=1
  AND NEW.value<>OLD.value
BEGIN SELECT RAISE(ABORT,'Strategy registry is frozen'); END;
CREATE INDEX IF NOT EXISTS mtf_market_lookup ON mtf_records(bucket,json_extract(value,'$.market')) WHERE bucket IN ('mtf_signals','mtf_analyzer_state','mtf_decision_audit');
CREATE INDEX IF NOT EXISTS mtf_run_lookup ON mtf_records(bucket,json_extract(value,'$.run_date'),json_extract(value,'$.symbol')) WHERE bucket='mtf_cedear_work';
CREATE INDEX IF NOT EXISTS mtf_job_lookup ON mtf_records(bucket,json_extract(value,'$.name')) WHERE bucket='mtf_jobs';

CREATE UNIQUE INDEX IF NOT EXISTS mtf_alert_event_dedupe ON mtf_records (
 json_extract(value,'$.group_key'),json_extract(value,'$.event_type')
) WHERE bucket='mtf_alert_events';
CREATE TRIGGER IF NOT EXISTS mtf_ledger_append_only_delete BEFORE DELETE ON mtf_records
WHEN OLD.bucket='mtf_alert_delivery_ledger' BEGIN SELECT RAISE(ABORT,'Delivery ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS mtf_ledger_append_only_update BEFORE UPDATE ON mtf_records
WHEN OLD.bucket='mtf_alert_delivery_ledger' BEGIN SELECT RAISE(ABORT,'Delivery ledger is append-only'); END;
