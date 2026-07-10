---
name: gas-optimization
description: Use when reducing gas costs, auditing gas usage, or refactoring Solidity/Yul for efficiency — when a contract should be cheaper to deploy or call, or when the user mentions high gas fees, SSTORE/SLOAD costs, storage packing, calldata vs memory, unchecked math, loop costs, or transient storage (EIP-1153).
---

# Gas Optimization

## Overview

Reduce the gas a contract spends without changing its observable behavior. **Every proposed saving is a hypothesis until measured.** The core discipline is: find candidates, rewrite one at a time, prove the behavior is unchanged, and prove the gas actually went down — discard anything that fails either proof.

**The Iron Rule: never claim a gas saving you have not measured.** A rewrite that "should" be cheaper but isn't, or that subtly changes behavior, is a regression. No exceptions for "obvious" wins.

## When to Use

- Lowering deployment or runtime gas of Solidity/Vyper/Yul contracts
- Symptoms: "gas too high", expensive `SSTORE`/`SLOAD`, large `for` loops, structs with many fields, `string memory`/`bytes memory` external args, repeated `.length` reads, `i++` in loops
- Considering `unchecked`, `constant`/`immutable`, mappings-over-arrays, bitwise tricks, or transient storage

**Do NOT use for:** correctness bugs or security audits (use vulnerability-scanning), or micro-tweaks to code that isn't on a hot path and isn't deployed at scale — readability usually wins there.

## Workflow

Run these four steps in order. They are reasoning steps **you** perform, not scripts.

1. **Seek** — Read the target contract and match it against the known waste patterns in [`reference/patterns.md`](reference/patterns.md). List every candidate with its location. Ground every later idea in the EVM cost facts in [`reference/cost-model.md`](reference/cost-model.md).
2. **Innovate** — For each candidate, propose one concrete rewrite. You may also propose novel rewrites beyond the library, but only if you can name the exact opcode/cost reason it's cheaper. Reject ideas you cannot justify from the cost model.
3. **Execute** — Apply rewrites **one at a time**, then verify each (see below). If verification fails, revert that rewrite and move on. Do not batch unverified changes.
4. **Manage** — After the loop, report each accepted change: location, pattern, measured gas delta (before → after), and any behavioral caveat. Be honest about rewrites you discarded and why.

## Verification (mandatory before accepting any rewrite)

A rewrite is accepted only if all three pass. If any fails, revert it.

1. **Security** — Prefer the MCP tool `evm_scan_vulnerabilities`; fall back to raw `slither <path>` when the MCP server is unavailable. The rewrite must not introduce reentrancy, uninitialized storage, unsafe `delegatecall`, or remove a needed check. Optimizations that touch `.call`/external calls or `unchecked` get extra scrutiny.
2. **Equivalence** — Behavior must be identical for the same inputs. Prefer Foundry differential/fuzz tests via the MCP tool `evm_run_tests` (structured pass/fail with fuzz counterexamples; falls back to raw `forge test`), including boundary and randomized inputs. If no test suite exists, say so and reason explicitly about why behavior is preserved — do not silently assume it.
3. **Measurement** — Gas must be **strictly lower**. Prefer the MCP tool `evm_analyze_gas_profile` (structured per-function min/avg/median/max); fall back to `forge snapshot` and `forge test --gas-report`. For storage-packing rewrites, verify the new slot assignment with `evm_inspect_storage_layout`. If gas is equal or higher, the pattern is invalid here — discard it.

**Graceful degradation:** if Slither/Foundry aren't installed, state that explicitly in the report, fall back to careful manual reasoning from the cost model, and mark the saving as *estimated, not measured*. Never present an estimate as a measurement.

## Quick Reference

| Pattern | Idea | Typical saving |
|---|---|---|
| Storage packing | Reorder struct/state vars so sub-256-bit fields share a 32-byte slot | ~20k gas/slot saved on write |
| `constant`/`immutable` | Move fixed values out of storage into bytecode | ~2.1k per avoided `SLOAD` |
| Calldata over memory | `calldata` for read-only external array/string args | copy + alloc avoided |
| Cache storage in loops | Hoist `arr.length` and storage reads to the stack | ~100/iter per avoided `SLOAD` |
| Unchecked counters | `unchecked { ++i; }` for bounded loop counters | ~30–40/op |
| Mappings over arrays | O(1) keccak slot vs O(n) scan | scales with n |
| Transient storage | `TSTORE`/`TLOAD` for intra-tx flags / flash accounting | 100 vs 20k per slot |
| Bitwise shifts | `shr(1,x)`/`shl(1,x)` for ÷/× powers of two | 3 vs 5 gas |
| Branchless Yul | Bitwise min/max avoids `JUMPI` | pipeline-friendly |

Full before/after examples and applicability rules: [`reference/patterns.md`](reference/patterns.md).
EVM cost hierarchy, memory layout, and Yul scratch space: [`reference/cost-model.md`](reference/cost-model.md).

## Common Mistakes

- **Claiming a saving without measuring it.** "Shifts are cheaper" is true per-opcode but the compiler may already optimize it — measure.
- **`unchecked` on user-controlled or balance math.** Only wrap arithmetic that logic already bounds (e.g. a loop index). Wrapping user input or token math creates overflow vulnerabilities — guard with `require` first.
- **Forgetting to clear transient storage.** `TSTORE` persists for the whole *transaction*, not the call frame. Reset flags (`locked = false`) or nested/batched calls inherit stale state.
- **Packing variables that are written in different transactions.** Packing only helps when packed fields are written together; otherwise you pay a read-modify-write on each separate update.
- **Batching many rewrites then testing once.** You lose the ability to attribute regressions. One rewrite, one verification.

## Red Flags — STOP

- "This is obviously cheaper, no need to measure" → measure it.
- "I'll wrap the whole function in `unchecked`" → only bounded arithmetic, and justify each one.
- "Tests don't exist so I'll assume behavior is the same" → state the assumption explicitly and reason from the cost model; mark as estimated.
- "Gas report shows it went up but the pattern is well-known" → discard it here.
