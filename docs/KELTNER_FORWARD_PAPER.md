# Keltner H4 forward observation cohort

This is an observation-based simulation, not an activated production trading strategy. It sends no orders or Telegram messages. The existing crypto/CEDEAR/ADR engines and their statistics remain separate.

The frozen protocol and SHA-256 identity are embedded in `paper/keltner-h4.json`. The initial cohort was created from current public quotes, with USD 10,000 fictitious capital and no historical entries. Each asset has one sixth of initial capital; no leverage, short positions or rebalancing within the 90-day experiment. Six assets: BTC, ETH, BNB, XRP, ADA and LTC against USDT (USDT is treated as USD; depeg risk is not modeled).

Rules: after a newly closed H4 bar, enter if its close exceeds EMA20 + 2.5 ATR14 and EMA200. Exit after a newly closed bar below EMA20, or when an observed quote is below the initial stop of entry fill minus 2 ATR14. No reentry on the same observation as an exit. End the cohort after 90 days and close outstanding simulated positions at the first subsequent observed quotes. Completion does not automatically approve the strategy.

Indicators use the same causal EMA/Wilder ATR formula as the research engine. Initialization uses 1,000 complete H4 bars, then persists and incrementally updates indicator state without resetting the seed. Thus initialization history differs from the longer historical research series; exact indicator equality is tested on identical input. The baseline's historical signal is ignored. Missing H4 bars are rejected rather than silently skipped. If observations miss several decision boundaries, indicators recover from available history, only the newest decision is eligible, and missed decisions are counted; past trades are never invented.

## Execution and accounting

Entries and exits use the first indicative last-price quote obtained by the collector, plus 5 bps adverse slippage and 10 bps commission per fill. Observation timestamps and signal-to-observation delay accompany trades. The relay can cache public data for 30 seconds; timestamps record receipt, not an exchange execution timestamp. Quotes are not executable bid/ask offers and fills are not real broker fills.

**Stops are observed, not standing orders.** The collector does not backfill a fill at a historical stop touched between checks. It exits at the first observed price below the stop, which can be much worse. Touches followed by recovery between samples may be missed. This differs materially from the historical intrabar stop model and directly tests an approximation of delayed manual execution. Hourly marks can understate intrahour drawdown. The UI labels maximum *observed* drawdown accordingly. NAV marks open positions after estimated exit costs; trading fees include actual simulated entry/exit fees but not hypothetical exit fees. Equal-weight buy-and-hold uses the same initial observed quotes and modeled costs, including estimated exit costs when marked. The experiment does not assume real user capital.

No history imports, parameter tuning, optimization or production signal insertion occur during collection. The engine/protocol hash rejects changing the rules within an existing cohort. Core changes require preserving the old cohort and starting a separately named new one. A stale UI record is labeled delayed after two hours and a read failure clears displayed metrics.

## Scheduler and persistence

`.github/workflows/keltner-paper.yml` runs at minute 7 each hour and supports manual dispatch. H4 decisions only occur when a new complete H4 bar is seen; intervening runs check prices/stops and mark NAV. GitHub scheduling can be delayed or suspended and is not an execution SLA. Workflow concurrency prevents overlapping collectors. A complete snapshot is written atomically only if all six assets pass validation. Failed collection preserves the last good snapshot; the UI then exposes its age.

Automated snapshot commits retain the repository owner as author (public noreply identity) and GitHub Actions as committer, so the existing owner-authorized Vercel integration can publish them.

The workflow uses GitHub's short-lived scoped `GITHUB_TOKEN` via checkout, with `contents: write`. No new personal token or Cloudflare deployment credential is required. Each run commits only the bounded paper snapshot to main, without source changes; Vercel serves the new static snapshot through the existing deployment integration. The console CI ignores pushes that only change `paper/**`; source changes still run the full suite. A rebase preserves an intervening application commit. Branch protection or disabled write permissions can block persistence and must be reported rather than bypassed.

No paid plan or service is created. A normal hourly job takes under one runner minute (roughly 720–744 Linux runner minutes/month); its timeout is two minutes. GitHub's free private-repository allowance is shared with other workflows, and existing hosting/free usage limits still apply. Collection is not guaranteed when those limits are exhausted. The ledger is small, retains the latest 300 events plus lifetime aggregate counts/P&L and stops updating after cohort completion.

## Run and verify

```sh
npm run paper:collect
node tests/paper-keltner.cjs
npm test
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
```

Do not rerun against another cohort file and present the fresh baseline as continuing performance. Preserve the initial `startedAt`, protocol and engine hash, historical trades, counters and indicator states. The browser displays the actual start time and distinguishes the paper cohort from operational signals. Ninety days of positive simulated returns alone do not prove profitability, safety or executable manual performance; review costs, drawdowns, missed observations, number of independent trades and new-market evidence before any activation decision.
