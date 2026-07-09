# EVM Security Rules

When modifying or writing Solidity code, you MUST adhere to the following rules:

1. **Checks-Effects-Interactions (CEI)**: Always perform state changes BEFORE making external calls to untrusted contracts. This mitigates reentrancy vectors.
2. **Custom Errors**: Do NOT use `require()` with string messages. Always define custom errors (e.g., `error Unauthorized();`) to save gas.
3. **Reentrancy Guards**: Apply `nonReentrant` modifiers on any function that performs external calls and modifies critical state, even if CEI is followed.
4. **SafeMath**: If using Solidity >= 0.8.0, rely on built-in overflow/underflow protection. Do not import `SafeMath` unless interacting with legacy contracts.
5. **Visibility**: Explicitly define visibility for all functions and state variables. Default to `private` or `internal` unless `public`/`external` is strictly required.

> When in doubt, run the `evm_scan_vulnerabilities` MCP tool to verify your changes.
