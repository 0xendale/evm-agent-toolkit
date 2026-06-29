# Arbitrage Strategies & Net-Profit Model

Analysis only — this skill quantifies opportunities; it does not execute trades.

## Net-profit model (basis points)
An opportunity is viable only when:

```
net_bps = spread_bps - fee_bps - gas_cost_bps - slippage_bps - validator_bribe_bps
viable   = net_bps > 0
```

- `spread_bps` — observed price gap between venues/legs.
- `fee_bps` — sum of pool/swap fees across all legs.
- `gas_cost_bps` — gas cost expressed in bps of trade size (depends on size & gas price).
- `slippage_bps` — expected price impact from trade size vs pool depth. Always
  estimate it; ignoring slippage is the most common way a "profitable" route loses money. Calculate Maximal Arbitrage Value (MAV).
- `validator_bribe_bps` — bribe paid to block builders/validators (often 90-95% of gross profit on competitive L1s).

## Strategy thresholds

| ID | Strategy | Min spread (bps) | Typical fee (bps) | Typical gas (bps) | Pattern |
|---|---|---|---|---|---|
| ARB-001 | Cross-DEX spot | 30 | 30 | 8 | Same pair on two AMMs; spread exceeds combined fee+gas. |
| ARB-002 | Triangular | 45 | 60 | 12 | Three-leg cycle on one venue closing above round-trip cost. |
| ARB-003 | Stable depeg | 15 | 8 | 6 | Stablecoin pair drifting from peg beyond fee+gas threshold. |

Thresholds are screening defaults — always recompute `net_bps` with the live
fee, gas, and slippage for the specific size; do not rely on the table alone.

## Reality caveats (state these in every report)
- **Competition/MEV & Bribes:** profitable spreads are contested by searchers; assume execution risk and that the spread may close before inclusion. In competitive L1s, expect 90-95% of gross profit to go to builders/validators as bribes.
- **Execution Risk:** Atomic MEV (e.g. flash loans in single tx) is risk-free as it reverts if unprofitable. Non-atomic MEV (cross-chain, CEX/DEX) carries high execution risk due to latency.
- **Depth vs size:** profit scales with size only until slippage erases it; report the size band where `net_bps > 0`. Use Maximal Arbitrage Value (MAV) for AMM bounding.
- **Stale quotes:** an opportunity computed from lagged quotes may not exist on-chain. (Note: L2s like zkSync have slower decay times than L1, but still pose risks).
