-- ADR v1 database-level guard: never allow two simultaneous ADR v1 operations per asset.
create unique index if not exists mtf_adr_v1_one_open_asset_uq
on public.mtf_signals(market,symbol)
where market='merval'
  and strategy_version='ADR-OB-v1.0'
  and source='FORWARD'
  and status='OPEN';
