# EVM MCP Server

An MCP (Model Context Protocol) server that gives autonomous coding agents deterministic, schema-validated tools for EVM smart contract development — security scanning, gas profiling, compiler diagnostics, and transaction simulation.

## Why This Exists

Raw CLI output from tools like Slither and Foundry is noisy, non-deterministic, and often causes LLMs to hallucinate. This server intercepts the output, validates it through Zod schemas, and returns clean JSON that any agent can reliably parse.

## Tools

| Tool | Annotations | Description |
|------|-------------|-------------|
| `evm_scan_vulnerabilities` | `readOnly`, `idempotent` | Run Slither analysis. Returns severity-rated findings with extracted code snippets. |
| `evm_analyze_gas_profile` | `readOnly`, `idempotent` | Run `forge test --gas-report`. Returns structured per-function gas data. |
| `evm_compile_and_diagnose` | `readOnly`, `idempotent` | Run `forge build`. Returns structured compiler diagnostics on failure. |
| `evm_simulate_transaction` | `readOnly`, `idempotent` | Run `cast call`. Returns decoded return data or revert reasons. |

## Resources

| URI | Description |
|-----|-------------|
| `evm://patterns/vulnerabilities` | Security vulnerability pattern library |
| `evm://gas/optimizations` | Gas optimization pattern library |
| `evm://patterns/arbitrage` | Arbitrage strategy reference |

## Architecture

```text
evm-agent-toolkit/
├── src/
│   ├── mcp/            # MCP server entry point (stdio transport)
│   ├── tools/          # Zod-validated CLI output parsers
│   │   ├── slither.ts  # Slither JSON → SanitizedFinding[]
│   │   ├── forge.ts    # Forge gas tables → ContractGas[]
│   │   ├── compiler.ts # Forge build errors → CompilerDiagnostic[]
│   │   └── simulator.ts# Cast call output → SimulatorDiagnostic
│   ├── rules/          # Agent system prompt injections
│   └── hooks/          # Lifecycle hooks (UserPromptSubmit, Statusline)
├── tests/              # Vitest unit tests for all parsers
├── bench/              # Performance benchmarks
├── evals/              # Agent evaluation framework (vulnerable contracts + eval XML)
├── skills/             # Markdown reference libraries
├── .claude-plugin/     # Claude Code plugin manifest
└── gemini-extension.json # Antigravity plugin manifest
```

## Setup

```bash
npm install
npm run build
```

## Agent Configuration

This is a stdio MCP server. It is spawned by the MCP client, not started manually.

**Claude Desktop / Cursor:**
```json
{
  "mcpServers": {
    "evm-agent-toolkit": {
      "command": "npx",
      "args": ["-y", "@0xendale/evm-agent-toolkit"]
    }
  }
}
```

**Prerequisites:** `slither`, `forge`, and `cast` must be installed on the host machine.

## Development

```bash
npm run dev       # Watch mode with tsx
npm run test      # Run all unit tests
npm run bench     # Run parser benchmarks
npm run build     # Compile TypeScript → build/
```

## Performance

Parser throughput (measured on Apple Silicon):

| Parser | Iterations | Time | Per-call |
|--------|-----------|------|----------|
| Slither (100 detectors) | 1,000 | ~109ms | ~0.1ms |
| Forge Gas Table | 10,000 | ~32ms | ~0.003ms |

## License

MIT
