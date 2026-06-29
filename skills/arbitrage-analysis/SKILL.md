---
name: arbitrage-analysis
description: Use when analyzing EVM/DeFi arbitrage opportunities — cross-DEX spot spreads, triangular cycles, stablecoin depegs, or MEV/price dislocation — or when the user wants opportunities quantified net of fees, gas, and slippage. Analysis only, not trade execution.
---

# Arbitrage Analysis

## Overview

Surface and quantify price-dislocation opportunities across venues, **net of fees,
gas, and slippage**. This is an analysis skill: it produces an opportunity ledger,
it does not execute trades.

**The Iron Rule: never call a route profitable without subtracting fees, gas, AND slippage.** A gross spread is not profit. Report the size band where net profit is positive, or say there is none.

## When to Use

- Screening DeFi venues for cross-DEX, triangular, or stablecoin-depeg arbitrage
- Symptoms: "is there an arb here?", spread/MEV/price-dislocation questions,
  quantifying an opportunity net of cost

**Do NOT use for:** security audits (use vulnerability-scanning) or gas
optimization (use gas-optimization). Do NOT treat its output as trade
authorization.

## Workflow

Four reasoning steps, in order.

1. **Seek** — From the pool/pair/quote inputs, detect dislocations against the
   thresholds in [`reference/strategies.md`](reference/strategies.md). List candidates with venues and observed spread.
2. **Innovate** — Propose a concrete route per candidate (the leg sequence and
   venues).
3. **Execute** — Compute `net_bps = spread_bps - fee_bps - gas_cost_bps - slippage_bps - validator_bribe_bps` for the specific trade size. In competitive L1 environments, bribes can consume 90-95% of gross profit. Factor in Maximal Arbitrage Value (MAV) for AMMs. Keep only routes with `net_bps > 0`; record the viable size band.
4. **Manage** — Emit the opportunity ledger: route, gross spread, each cost
   component, net bps, viable size band, and the reality caveats (MEV, depth,
   staleness).

## Quick Reference

| Strategy | Min spread (bps) | Net rule |
|---|---|---|
| Cross-DEX spot | 30 | `spread - fee - gas - slippage > 0` |
| Triangular | 45 | round-trip net > 0 across 3 legs |
| Stable depeg | 15 | net > 0 after fee+gas+slippage |

Model and caveats: [`reference/strategies.md`](reference/strategies.md).
Heuristics and Network Frictions: [`reference/patterns.md`](reference/patterns.md).

## Common Mistakes

- **Reporting gross spread as profit.** Subtract fee + gas + slippage, always.
- **Ignoring slippage / pool depth.** A spread that's profitable at small size
  inverts at large size.
- **Presenting analysis as executable certainty.** Spreads are contested by MEV
  and may close before inclusion.
- **Conflating atomic and non-atomic MEV.** Atomic executes risk-free; non-atomic carries high execution risk due to latency.
- **Ignoring builder bribes.** On Ethereum L1, searchers often pay 90-95% of their arbitrage profits to validators/builders.

## Red Flags — STOP

- "The spread is 50 bps so it's profitable" → subtract all costs and slippage.
- "It's profitable" with no size band → report where `net_bps > 0`.
- "Execute this trade" → out of scope; this skill only analyzes.
- Omitting validator bribes from the cost basis when analyzing competitive L1 MEV.
