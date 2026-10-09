-- Enforce the same one-position rule as the engines, including legacy v1
-- positions that still block a new v2 entry. Never delete or merge signals.
SET lock_timeout = '2s';
SET statement_timeout = '15s';
CREATE UNIQUE INDEX IF NOT EXISTS mtf_manual_one_open_per_asset
ON public.mtf_signals (market, symbol)
WHERE source = 'FORWARD' AND status = 'OPEN'
  AND strategy_version IN (
    'MACD-OB-v1.0', 'MACD-OB-v2.0',
    'CEDEAR-MACD-OB-v1.0', 'CEDEAR-MACD-OB-v2.0', 'ADR-OB-v1.0'
  );
RESET lock_timeout;
RESET statement_timeout;
