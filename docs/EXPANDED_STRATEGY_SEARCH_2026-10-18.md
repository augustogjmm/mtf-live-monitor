# Expanded strategy search — 18 October 2026 UTC

This replaces the breadth of the original 30-comparison experiment with **409 specifications across 16 families**, evaluated on crypto daily, crypto H4 and CEDEAR daily: **1,227 market/timeframe configurations**. It does not establish an optimal strategy over all possible rules. The previously inspected history is reused, so this is exploratory walk-forward research, not a fresh independent holdout. No production entry rules or real orders are changed.

## Findings

Crypto evaluation spans 1 January 2023–16 October 2026. CEDEAR evaluation spans July 2025–16 October 2026. Returns are cumulative after modeled execution costs, not annual returns.

| Procedure selected from prior training only | Net return | CAGR | Continuous maximum drawdown | Costs ×3 return | One-bar delay return |
|---|---:|---:|---:|---:|---:|
| Crypto daily | +18.1% | +4.5% | 61.2% | −2.4% | +17.5% |
| Crypto H4 | +70.4% | +15.1% | 25.4% | +2.4% | +47.1% |
| CEDEAR daily | −17.0% | −13.4% | 21.9% | −32.8% | −14.8% |

These are different procedures from picking the best full-period rule afterward. Maximum training drawdown of 25% does not bound subsequent losses: the daily procedure demonstrates this clearly.

### Retrospective finalists and a measurable improvement

Highest cumulative active daily crypto return was RSI14 trend above 55, exit below 50, initial stop 3 ATR: +108.9%, CAGR 21.4%, maximum drawdown 36.6%. Buying and holding the same crypto basket with yearly window reconstitution earned +145.9%; its superior return alone does not establish safety.

A more robust H4 research candidate is `keltner-338`: close above EMA20 + 2.5 ATR14 and above EMA200; exit on close below EMA20; initial stop 2 ATR14. Execute signals at the next open, never at the triggering candle close. Long only, no leverage, one position per asset, equal asset sleeves, full sleeve allocation. ATR uses causal Wilder smoothing seeded from the first bar; at least 200 bars warm-up. A gap through the stop fills at the adverse opening, with costs.

| H4 variant, EMA200 filter | Base return | CAGR | Max drawdown | Costs ×3 | Two-bar delay | Closed trades |
|---|---:|---:|---:|---:|---:|---:|
| Bollinger 2σ, stop 5 ATR | +93.4% | 19.0% | 24.1% | −1.5% | +24.8% | 686 |
| Keltner 2 ATR, stop 2 ATR | +86.6% | 17.9% | 23.2% | +20.0% | +32.4% | 476 |
| Keltner 2.5 ATR, stop 2 ATR | +80.2% | 16.8% | 21.8% | +29.4% | +46.1% | 351 |

Widening the Keltner entry channel reduced turnover and observed drawdown while improving adverse-cost and delay results, at the expense of base profit. This is an observed robustness tradeoff, not proof that the parameter is optimal. Its base fold returns were +16.4%, +48.9%, +0.04%, +3.9%; recent performance is weak. It was chosen after seeing these outcomes and is **not approved for live use**.

For comparison, halving the daily MACD finalist's allocation reduced maximum drawdown from 27.3% to 16.2%, but reduced cumulative return from 107.7% to 54.6%. In CEDEAR, idle cash stays in pesos: reducing exposure can worsen USD returns through currency depreciation. The best retrospective active CEDEAR model earned only +6.7% and lost 10.6% at tripled costs. Buy-and-hold earned +32.4% on the same window boundaries, excluding unverified local dividends.

Each finalist also received 1,000 deterministic seven-session block resamplings. Keltner-338 had a 5th-percentile resampled return of −4.2% and a 95th-percentile maximum drawdown of 34.2%. These are conditional scenarios based on observed returns, not confidence bounds or predictions. They do not correct for multiple comparisons or eliminate selection bias.

## Reproducible catalog

The complete parameter catalog is `docs/research/broad-catalog-2026-10-18.json`; formulas are in `scripts/lib/broad-research.cjs`.

| Family | Entry / exit outline |
|---|---|
| Buy-and-hold | Enter after warm-up; liquidate at window boundary |
| EMA trend | Price above fast EMA above slow EMA; exit below fast EMA |
| Donchian | Close above prior 20/55-bar high; exit below prior 10/20-bar low |
| Momentum | Positive 90/180-bar return; exit nonpositive |
| RSI2 pullback | RSI2 below 5/10/20; exit above 70/90 or after 10 bars |
| RSI14 reversion | RSI14 below 25/30/35; exit above 60 or after 20 bars |
| RSI14 trend | RSI14 above 55/60; exit below 50 |
| Bollinger reversion | Below SMA20 minus 1.5/2/2.5 population standard deviations; exit at SMA20 or 20 bars |
| Bollinger breakout | Above upper band; exit below SMA20 |
| Keltner breakout | Above EMA20 plus 1.5/2/2.5 ATR14; exit below EMA20 |
| MACD | EMA12−EMA26 above its EMA9 signal; optional MACD above zero; exit negative histogram |
| Squeeze-inspired | First release from BB20/2 inside ATR14×1.5 channel, positive centered momentum and MACD histogram; exit negative momentum or histogram |
| ADX directional | ADX14 above 20/25/30 with positive directional dominance; exit dominance reversal or below EMA20 |
| Ichimoku midpoint variant | Above current 26/52 midpoints and midpoint9 above midpoint26; exit below midpoint26 |
| Structure breakout | Close above preceding 20-bar high with bullish body above 0/0.5/1 ATR; exit below prior low or EMA20 |
| Trend pullback | Low below EMA20, close back above it and above prior close; exit below EMA50 |

Most families are tested with and without EMA200 trend filters. All active base specifications have stops of 2/3/5 ATR and allocations of 50%/100%. This is 408 active specifications plus buy-and-hold. Squeeze is an explicitly simplified Carter-inspired implementation, **not the proprietary TTM Squeeze**. Ichimoku uses current midpoints without displaced clouds. Structure means the precise breakout rules above, not an unimplemented discretionary order-block methodology. No identifiable Trade Latino rulebook was provided; no official Trade Latino implementation is claimed. The study does not cover all possible strategies, shorts, leverage, options, every asset or the ADR production engine.

## Selection and stress protocol

For each market/timeframe, rank training CAGR among active models with positive CAGR, at least 20 closed trades (including boundary liquidations) and training drawdown at most 25%; choose the first deterministic ranked candidate. If none qualify, hold cash. Crypto uses the preceding three years, with annual test windows in 2023, 2024, 2025 and partial 2026. CEDEAR uses available prior official history, with test windows July–December 2025, January–June 2026 and July–October 2026. Short local training periods are a material limitation.

Every window starts with equal asset sleeves and ends with liquidation; capital compounds across windows, with asset weights reset. Continuous drawdown includes the compounded equity path. The CSV's `worst_fold_drawdown` is a different diagnostic and must not be presented as continuous drawdown. Retrospective finalist screening uses this diagnostic before computing their actual continuous risk.

Costs per fill: crypto commission 10 bps and slippage 5 bps; CEDEAR commission 60 bps and slippage 20 bps. Stress doubles/triples both, delays signals by one/two whole bars and resamples daily returns in seven-session blocks. A signal delay is not an exact model of manual intrabar execution. Stops can fill on the entry bar. No profit targets, borrowing, paid data, taxes, interest, funding or automatic trading are assumed.

Data: six liquid surviving Binance USDT pairs (BTC, ETH, BNB, XRP, ADA, LTC); ten official BYMA CEDEAR histories (AAPL, MSFT, AMZN, GOOGL, META, NVDA, KO, XOM, JNJ, WMT). CEDEAR indicators use adjusted US-underlying closes strictly before the local opening, local fills use BYMA, and USD marking uses an approximate GGAL CCL proxy. Local cash stays ARS. Local dividends and broker custody deductions are not verified. Survivorship, approximate FX, narrow universe, observed-history reuse and parameter selection bias remain. Results do not justify claims of guaranteed safety or a statistically proven universal winner.

## Reproduction

Requires the repository's Node 24 runtime. No token, paid service or market order is required.

```sh
mkdir -p /tmp/mtf-broad-source
tar -xzf research-data/strategy-search-2026-10-17.tar.gz -C /tmp/mtf-broad-source
npm run research:broad -- /tmp/mtf-broad-source /tmp/mtf-broad-run
node scripts/stress-broad-finalists.cjs /tmp/mtf-broad-source /tmp/mtf-broad-run/results.json /tmp/mtf-broad-run/finalists.json
npm test
```

Use a new output directory for each run: the catalog cannot be overwritten. Raw files are checked against their manifest; source/engine identities accompany reports; stress rejects a different engine or source manifest. The earlier frozen research engine is unchanged. The catalog is persisted before evaluation, but because the histories and earlier study were already inspected this does **not** turn the expanded study into prospective preregistration. New evidence requires forward observations with frozen rules and realistic manual fills; favorable historical ranking is not sufficient for activation.
