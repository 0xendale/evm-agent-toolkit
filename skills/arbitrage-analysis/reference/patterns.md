# Arbitrage Patterns & Heuristics

This file contains attributable and versioned heuristics for EVM arbitrage analysis.

| ID | Impact | Signature | Source |
|---|---|---|---|
| ARB-PAT-001 | High | **Atomic vs Non-Atomic Execution**: Atomic MEV (single transaction/chain, flash loans) has zero execution risk as it reverts on failure. Non-atomic (CEX/DEX, Cross-chain) carries high execution risk due to latency and competition. | Arbitrage Typology |
| ARB-PAT-002 | High | **Validator Bribes**: In competitive Ethereum L1 PBS environments, searchers must allocate 90-95% of gross profits directly to block builders/validators (via `block.coinbase.transfer` or Jito tips) to guarantee inclusion. | MEV Dynamics |
| ARB-PAT-003 | Medium | **FCFS L2 Sequencing**: Optimism and Base operate on First-Come, First-Served sequencing with no public mempool/PBS auctions, leading to a "spam-as-strategy" approach where bots spam probabilistic transactions. | Network Microstructure |
| ARB-PAT-004 | Medium | **Solana Microstructure**: Solana operates without a public mempool with 400ms block intervals. Arbitrageurs rely on off-chain bundle auctions via the Jito-Solana client, paying Jito tips rather than standard gas bids. | Network Microstructure |
| ARB-PAT-005 | High | **CPMM Maximal Arbitrage Value (MAV)**: For a CPMM (price $P_a$) vs CEX (price $P_c$), optimal volume $V_{max} = \frac{y \cdot (P_a - P_c)}{2P_a}$ and absolute total profit $MAV = \frac{y \cdot (P_a - P_c)^2}{4P_a}$. | AMM Math |
| ARB-PAT-006 | Medium | **Loss-Versus-Rebalancing (LVR)**: Adverse selection cost for AMM LPs due to stale prices being picked off. Instantaneous frictionless LVR rate is defined as $v/8$ per unit pool value ($v$ = asset variance). | AMM Math |
| ARB-PAT-007 | High | **Flash Loan & Circuit Breakers**: Atomic MEV execution relies on flash loans for uncollateralized capital, requiring custom smart contracts (BundleExecutor) with strict access controls and circuit breakers that automatically `revert` if net profit thresholds are not met. | Bot Architecture |
| ARB-PAT-008 | Medium | **L2 Arbitrage Decay**: Unlike Ethereum L1 where discrepancies resolve in a single block, L2 rollups (e.g., zkSync Era) often see price disparities persist for 10 to 20 blocks. | MEV Dynamics |
