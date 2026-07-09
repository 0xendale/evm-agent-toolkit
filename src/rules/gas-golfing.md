# EVM Gas Golfing Rules

When optimizing Solidity for gas consumption, adhere to these rules:

1. **Storage Packing**: Group state variables of reduced sizes (e.g., `uint128`, `uint64`, `bool`) sequentially in the contract so they pack into a single 32-byte slot.
2. **Caching State**: If you read a state variable more than once in a function, cache it in memory (`uint256 localCache = stateVar;`) and operate on the cache.
3. **Calldata over Memory**: Use `calldata` for array and struct function parameters instead of `memory` when the variable does not need to be mutated.
4. **Unchecked Loops**: For array iteration, use `unchecked { ++i; }` at the end of the loop since `i` cannot realistically overflow the maximum array length.
5. **Custom Errors**: Use custom errors instead of `require` string messages to drastically reduce deployment and runtime gas.

> Run the `evm_analyze_gas_profile` tool to verify the numeric impact of your optimizations.
