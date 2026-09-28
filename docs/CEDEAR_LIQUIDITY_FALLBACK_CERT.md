# CEDEAR Liquidity Fallback Certification

## Scope

This certificate covers the CEDEAR liquidity-universe resilience fix in MTF Live Monitor 3.8.1. It certifies implementation correctness and observability only; it does not certify trading profitability or signal quality.

## Incident reproduced

On 2026-09-28, the current BYMA turnover feed produced 539/539 CEDEAR rows with ADTV5 = 0 and ADTV20 = 0. Selecting the liquid universe from those values would have produced an empty universe.

The fallback restored the last valid liquid universe:

- Current CEDEAR rows: 539
- Current feed with zero ADTV20: 539
- Fallback universe: 185
- Last valid universe date: 2026-09-25
- Symbols present today but not in fallback: 0
- Symbols present in fallback but not today: 0
- Liquidity-rank mismatches: 0

## Certified behavior

When the current BYMA turnover-derived liquid universe is non-empty, the monitor uses BYMA_CURRENT_TURNOVER.

When the current turnover feed is invalid and would yield an empty liquid universe, the monitor uses BYMA_LAST_VALID_UNIVERSE_FALLBACK, preserving the last valid eligible symbols and liquidity ranks.

The fallback affects only liquidity-universe selection/ranking. It does not turn stale turnover numbers into current data, and the UI must not display zero current turnover as if it were a valid liquidity measurement.

## Observability contract

mtf_latest_cedear_snapshot() exposes:

- liquidity_basis
- current_turnover_valid
- fallback_run_date
- universe_rule

The API propagates this metadata. The CEDEAR scanner shows the fallback date instead of a misleading current BYMA amount, and Status Page reports a WARNING while the market is expected to be active and the fallback is in use.

A fallback is a degraded-but-controlled operating mode, not a healthy current-data state.

## QA evidence

- Fallback production invariants: 8/8 PASS
- Current eligible universe vs 2026-09-25: 185/185 exact symbol match
- Liquidity ranks vs 2026-09-25: 0 mismatches
- GitHub mtf-daily-backfill source vs deployed Supabase Edge Function v79: exact match
- ADR v1 certified logic is unchanged.
- Crypto v3.7.3 logic is unchanged.
- CEDEAR v3.6 signal rules are unchanged; this change is data-resilience and observability only.

## Certification status

CEDEAR_LIQUIDITY_FALLBACK_IMPLEMENTATION_CERTIFIED

Any future change to the fallback selection rule, freshness semantics, liquidity ranking, or UI health classification requires re-running the certification SQL in tests/cedear-liquidity-fallback-certification.sql.
