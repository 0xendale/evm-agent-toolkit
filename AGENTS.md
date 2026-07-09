# EVM MCP Server — Contributor & Architecture Guide

This file orients any agent (or human) working **inside this repository**.

## What this repo is

A professional MCP (Model Context Protocol) server that gives autonomous coding
agents deterministic, schema-validated tools for EVM smart contract development.

## Architecture

```
evm-agent-toolkit/
├── src/
│   ├── mcp/index.ts        # MCP server entry point (registerTool API)
│   ├── tools/              # Zod-validated CLI output parsers
│   ├── rules/              # System prompt injection files (.md)
│   └── hooks/              # Lifecycle hooks (UserPromptSubmit, Statusline)
├── tests/                  # Vitest unit tests for all parsers
├── bench/                  # Parser performance benchmarks
├── evals/                  # Agent evaluation framework
├── skills/                 # Markdown reference libraries (read-only knowledge base)
├── docs/                   # Design documents and proposals
├── .claude-plugin/         # Claude Code plugin manifest
├── gemini-extension.json   # Antigravity plugin manifest
├── package.json            # npm package: evm-mcp-server
└── tsconfig.json           # Strict TypeScript, ESM, declarations enabled
```

## Key conventions

### Naming
- **Server**: `evm-mcp-server` (convention: `{service}-mcp-server`)
- **Tools**: `evm_{action}_{resource}` (e.g., `evm_scan_vulnerabilities`)

### API
- Use `server.registerTool()` — **never** `server.tool()` (deprecated)
- Every tool must have `title`, `description`, `inputSchema` (Zod), and `annotations`
- Use `z.looseObject()` — **never** `.passthrough()` (deprecated in Zod v4)
- Use `z.unknown()` — **never** `z.any()` (deprecated in Zod v4)
- Use `catch (error: unknown)` — **never** `catch (error: any)`
- All logging goes to `stderr` — stdio servers must never write to stdout
- Tool errors return `isError: true`

### Build
- `npm run build` must pass with zero errors before any commit
- `npm run test` must pass all parser tests
- Output goes to `build/` (gitignored)

## What to edit

| I want to change...                | Edit this |
|-------------------------------------|-----------|
| Add/modify an MCP tool              | `src/mcp/index.ts` + parser in `src/tools/` |
| Add a new CLI parser                | `src/tools/{name}.ts` + test in `tests/{name}.test.ts` |
| Change agent behavior rules         | `src/rules/*.md` |
| Change lifecycle hooks              | `src/hooks/*.ts` |
| Add reference knowledge             | `skills/{name}/reference/*.md` |
| Update eval questions               | `evals/mcp_eval.xml` |
| Update plugin manifests             | `.claude-plugin/plugin.json` or `gemini-extension.json` |

## How to add a new tool

1. Create `src/tools/{name}.ts` with a Zod-validated parser function.
2. Create `tests/{name}.test.ts` with at least 3 test cases.
3. Register in `src/mcp/index.ts` via `server.registerTool()` with full metadata.
4. Run `npm run build && npm run test`.
5. Update `evals/mcp_eval.xml` with eval questions for the new tool.
6. Bump `version` in `package.json` and `.claude-plugin/plugin.json`.
