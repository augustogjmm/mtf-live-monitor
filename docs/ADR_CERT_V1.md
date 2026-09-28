# ADR_CERT_V1

## Certified implementation

**Strategy:** `ADR-OB-v1.0`  
**Engine:** `ADR_DW_15M_RECOVERY_V1`  
**UI build:** `MTF-Live-Monitor-3.8.0-ADR-CERT-V1`

This certificate covers implementation correctness and production wiring. It does **not** certify profitability, expected returns, or a complete real-trade lifecycle before the first qualifying live ADR signal occurs.

## Frozen trading contract

- Long only.
- Daily Order Blocks define structure and location.
- Daily and Weekly context must both be `ALCISTA`.
- A simple OB touch is never an entry.
- Entry requires a **closed 15-minute confirmation candle** that:
  - overlaps an active bullish Daily OB;
  - crosses the OB center;
  - closes back above the center;
  - closes bullish;
  - has lower wick >= 20% of candle range;
  - does not chase beyond OB top + 0.25 ATR14.
- Entry price is the confirmation candle close.
- Target is the nearest valid active bearish Daily OB above entry.
- Technical invalidation = bullish OB bottom - 0.25 ATR14.
- Technical invalidation is reference/analytics only; there is **no automatic stop**.
- Planned reward/risk must be >= 1.8R.
- TP1 is the final system exit.
- One active ADR operation per asset.
- Intraday 15m is execution confirmation only, not a directional trend filter.
- Live entry/monitoring requires USA market open.
- Source: Yahoo Finance ADR USD.

## Isolation guarantees

- ADR live generation is isolated in `mtf-adr-engine`.
- The old shared regulated worker is CEDEAR-only and cannot create competing ADR entries.
- ADR runtime state is stored in `mtf_state.market='adr_live'`.
- A partial unique DB index prevents two simultaneous `ADR-OB-v1.0` OPEN operations for the same asset.
- Canonical statistics count merval/ADR only from `ADR-OB-v1.0`.

## QA evidence

- Deterministic engine self-tests: **8/8 PASS**.
- Production DB/runtime certification invariants: **21/21 PASS**.
- ADR runtime snapshot: **14/14 assets READY**.
- Decision audit persistence: PASS; no audit errors at certification time.
- Production watcher invocation: HTTP 200.
- ADR engine/dispatcher/watcher recent edge executions inspected: HTTP 200, no observed 5xx in the certification window.
- Frontend inline JavaScript syntax: PASS.
- API JavaScript syntax: PASS.
- Production endpoints for page, health, status, ADR runtime, ADR panel and statistics: HTTP 200.
- Vercel deployment: completed successfully.
- Statistics reconciliation: `OK`.
- Telegram ADR risk text explicitly states technical invalidation is reference-only and does not advertise Crypto BE protection.

## Certification boundary

**Status:** `IMPLEMENTATION_CERTIFIED`

Still pending by definition:

- **First real live trade end-to-end:** `PENDING_FIRST_SIGNAL`.
  When the first ADR v1 operation occurs, it must be checked through entry eligibility, persisted signal, Telegram ENTRY, runtime tracking, TP1 closure and statistics reconciliation.
- **Economic performance / strategy profitability:** `NOT_CERTIFIED`.
  This requires forward operational sample data and cannot be inferred from implementation QA.

Any future change to entry confirmation, D/W context, RR, target selection, stop semantics, TP1 behavior, universe, data source, or watcher handling requires a new strategy/certificate version rather than silently modifying this certified contract.
