# Additional portfolio strategy search — 19 October 2026 UTC

The prior search was extended with **36 portfolio policies**: 18 policies on crypto daily and 18 on crypto H4. This tests an additional hypothesis: combining different entry families and changing capital allocation may improve the profit/drawdown tradeoff. It is not a new independent holdout and does not establish a universally winning strategy. Previously inspected 2023–16 October 2026 evaluation histories are reused.

## What was tested

Each training window considers the existing 204 full-allocation active specifications. Eligible models must have positive CAGR, at least 20 closed trades, maximum training drawdown <=25%, and positive training CAGR at tripled fees and slippage. Rank them by base CAGR, base Calmar or tripled-cost CAGR. Choose the best one, or the best three/five distinct families. Allocate either 50% or 100% of capital across the chosen models; the rest stays in USD cash. Capital is allocated once at each window start, not rebalanced daily. Each strategy sleeve pays its own fees; no free order netting is assumed. All exposures remain spot long-only, with no leverage.

The 18 policies are compared on the preceding three years of training. Choose the highest training Calmar policy (CAGR divided by maximum drawdown), with training drawdown <=25%; break ties by CAGR. If none qualifies, hold cash. Apply it unchanged in the following yearly window (2023, 2024, 2025, partial 2026). Liquidate with fees at window boundaries and compound into equal initial asset sleeves in the next window. Policy selection never uses its following window's result. The catalog is written before execution, but the older history has already been inspected, so this is exploratory rather than prospective preregistration.

Data, universe, fees, slippage and strategy execution rules are unchanged from the expanded study. Binance BTC/ETH/BNB/XRP/ADA/LTC spot histories are verified against the immutable archive's manifest. Base costs per fill are 10 bps commission + 5 bps slippage. Selection is also tested with both costs tripled and with one full bar of signal delay. This extension does not evaluate CEDEAR or the ADR production engine.

## Result

| Training-selected portfolio procedure | Cumulative return | CAGR | Continuous drawdown | Return at tripled costs | Return with one-bar delay |
|---|---:|---:|---:|---:|---:|
| Crypto daily | +102.2% | +20.4% | 30.7% | +75.0% | +86.8% |
| Crypto H4 | +59.8% | +13.1% | 24.5% | +6.2% | +46.5% |

The first meta-selection experiment maximized training CAGR. That control chose a single full-allocation model in every fold, reproducing the previous expanded study (+18.1% daily and +70.4% H4). This is expected: a fixed mix cannot exceed its highest-return eligible component in the same training window. It does not establish that ensembles cannot improve future performance.

A second exploratory experiment selects by training Calmar instead. Its daily procedure improves the historical return/drawdown tradeoff relative to that control: +102.2% rather than +18.1%, with drawdown 30.7% rather than 61.2%. However, its fold returns are +19.7%, +116.1%, −11.4% and −11.8%. Two recent losing windows and a 30.7% drawdown preclude calling it a safe or proven winning strategy. The 25% training constraint does not cap subsequent losses. H4 reduces drawdown slightly but sacrifices base return relative to its control.

Both meta-selectors were tried sequentially after prior history was inspected. The second result is therefore an exploratory improvement, not a newly untouched test or a correction for multiple comparisons. The source reproduces the Calmar meta-selector; the prior published broad study provides the CAGR control. No new candidate replaces the frozen forward cohort based on this retrospective comparison.

Retrospectively, choosing H4 policies by Calmar with a single family yielded +69.5% and a 24.7% drawdown. Three-family Calmar diversification yielded +41.6% and a 23.1% drawdown. Halving the CAGR-selected policy's capital yielded +33.4% and a 13.7% drawdown. These comparisons show a return/risk tradeoff. Selecting a new winner from these full-period results would reuse evaluation data and would need additional independent evidence.

The daily policy with the largest retrospective return achieved +55.9% with 44.9% drawdown. Its high drawdown prevents presenting it as a safe solution. No new policy or production strategy is activated by this experiment; the existing frozen Keltner H4 paper cohort is preserved.

## Forward evidence and current limitation

The separate cohort began on 18 October 2026 with current quotes and no imported historical entries. At the first inspection on 19 October it had only four observations and no closed trades. GitHub's nominal hourly schedule had actually produced successful observations roughly 2.5–3 hours apart; sampling is best effort, not an execution SLA. A further manual workflow dispatch succeeded without resetting the cohort. The paper panel already marks records over two hours old as delayed.

Less than a day with no closed trades cannot validate profitability. The portfolio experiment adds historical evidence but cannot manufacture independent future market observations. There is therefore no evidence to mark the user's objective of a reliable winning strategy as completed. The missing prerequisite is sufficient new, frozen-rule, realistic-execution evidence—not another token or a paid plan. Verification requires new observations that are not yet available. The automated cohort continues collecting it; its existence does not guarantee a future positive outcome.

## Reproduce

```sh
mkdir -p /tmp/mtf-portfolio-source
tar -xzf research-data/strategy-search-2026-10-17.tar.gz -C /tmp/mtf-portfolio-source
npm run research:portfolios -- /tmp/mtf-portfolio-source /tmp/mtf-portfolio-run
node tests/research-portfolio.cjs
```

Use a new output directory. Raw manifest and source hashes are recorded. The source protocol and outputs are `docs/research/portfolio-protocol-2026-10-19.json` and `portfolio-results-2026-10-19.json`. `retrospectivePolicyRanking` reuses test folds and must not be confused with the training-selected `selectedWalkForward` result. All values are simulations, not real trading results. Survivorship bias, the finite strategy/universe catalog, previously inspected data, approximate next-open fills and manual execution differences remain material limitations.
