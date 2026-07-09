# EVM Skills Hub: Autonomous Agent MVP

## Problem Statement
How might we provide highly deterministic, schema-validated EVM security and gas analysis tools to autonomous coding agents so they can execute reliable self-correction loops?

## Recommended Direction: The "Sanitized Schema" Pipeline
The MCP Server will not return raw text/stdout. Instead, every tool (e.g., Slither, Foundry) will have its CLI output intercepted by the server, parsed into a strict TypeScript/Zod schema, and returned as a guaranteed, clean JSON structure. If a tool fails to execute, the server returns a deterministic error schema rather than a stack trace.

## Key Assumptions to Validate
- [ ] **Assumption 1**: The LLM can reliably parse the sanitized JSON output better than raw CLI stdout. *(Test: Compare agent success rate on raw vs sanitized output).*
- [ ] **Assumption 2**: Slither's `--json -` output is stable enough for us to parse into a Zod schema without crashing the MCP server. *(Test: Unit test the MCP tool against a known vulnerable contract).*
- [ ] **Assumption 3**: Agents will correctly resolve and read `evm://` resources when prompted by the tool's output.

## MVP Scope (What we are building now)
- **In Scope:**
  - `evm_scan_vulnerabilities` tool with strict Zod output validation.
  - `evm_analyze_gas_profile` tool parsing `forge` output into JSON.
  - Comprehensive unit test suite covering tool output serialization.
- **Not Doing (and Why):**
  - *Live Arbitrage execution*: Too complex for the initial autonomous loop validation. We will mock the arbitrage output for now.
  - *Custom Slither detectors*: We will rely on standard Slither output to keep the MVP focused on the MCP architecture, not Python development.

## Open Questions
- Should the MCP server automatically attach the relevant `evm://` pattern text inside the tool response, or should we force the agent to make a second tool call to `ReadResource` to get it?
