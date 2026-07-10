#!/usr/bin/env node
/**
 * EVM MCP Server
 *
 * Provides autonomous coding agents with deterministic, schema-validated
 * EVM security analysis, gas profiling, compiler diagnostics, and
 * transaction simulation tools via the Model Context Protocol.
 *
 * Transport: stdio (spawned by the MCP client)
 * Naming: evm-agent-toolkit
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  parseSlitherOutput,
  SanitizedFindingSchema,
  type SanitizedFinding,
} from "../tools/slither.js";
import { parseForgeGasReport, ContractGasSchema } from "../tools/forge.js";
import {
  parseForgeBuildOutput,
  CompilerDiagnosticSchema,
} from "../tools/compiler.js";
import { parseCastCallOutput, SimulatorDiagnosticSchema } from "../tools/simulator.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CHARACTER_LIMIT = 25_000;
// Slither JSON on large projects can exceed the 1 MiB execFile default.
const MAX_BUFFER = 16 * 1024 * 1024;

// Package root resolved from the module location, NOT process.cwd() — when the
// server is spawned via `npx -y @0xendale/evm-agent-toolkit`, cwd belongs to
// the MCP client, not this package.
const PKG_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

function truncateIfNeeded(text: string): string {
  if (text.length > CHARACTER_LIMIT) {
    return (
      text.slice(0, CHARACTER_LIMIT) +
      `\n\n[TRUNCATED] Response exceeded ${CHARACTER_LIMIT} characters. Use filters or pagination to narrow results.`
    );
  }
  return text;
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "ENOENT"
  );
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "evm-agent-toolkit",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Tool 1: evm_scan_vulnerabilities
// ---------------------------------------------------------------------------
const SEVERITY_LEVELS = ["High", "Medium", "Low", "Informational"] as const;

interface ScanPayload {
  findings: SanitizedFinding[];
  totalFindings: number;
  truncated: boolean;
  // SDK's structuredContent is typed as { [x: string]: unknown }
  [key: string]: unknown;
}

/**
 * Drop whole findings (never split one mid-JSON) until the serialized payload
 * fits inside CHARACTER_LIMIT. Output is always valid JSON.
 */
function buildScanPayload(findings: SanitizedFinding[]): ScanPayload {
  const totalFindings = findings.length;
  const kept = [...findings];
  let payload: ScanPayload = { findings: kept, totalFindings, truncated: false };
  while (
    kept.length > 0 &&
    JSON.stringify(payload, null, 2).length > CHARACTER_LIMIT
  ) {
    kept.pop();
    payload = { findings: kept, totalFindings, truncated: true };
  }
  return payload;
}

server.registerTool(
  "evm_scan_vulnerabilities",
  {
    title: "Scan EVM Vulnerabilities",
    description: `Run Slither static analysis on a Solidity contract and return schema-validated vulnerability findings.

Each finding includes the detector name, severity, description, source file, line numbers, and the actual code snippet extracted from the file system.

Args:
  - contractPath (string): Absolute path to the Solidity file or Foundry project root
  - severityFilter (string[], optional): Only return findings at these severities ("High" | "Medium" | "Low" | "Informational")
  - maxFindings (number, optional): Cap the number of findings returned (default: all)

Returns:
  JSON object:
  {
    "findings": [
      {
        "check": string,        // Slither detector id (e.g. "reentrancy-eth")
        "severity": string,     // "High" | "Medium" | "Low" | "Informational"
        "description": string,  // Human-readable explanation
        "file": string,         // Relative path to the source file
        "lines": number[],      // Affected line numbers (1-indexed)
        "code_snippet": string  // Extracted source code from the file
      }
    ],
    "totalFindings": number,    // Total before truncation/capping
    "truncated": boolean        // true if findings were dropped to fit the response limit
  }

Examples:
  - "Audit src/Vault.sol for reentrancy" → contractPath = "/path/to/src/Vault.sol"
  - "Run security scan on my Foundry project" → contractPath = "/path/to/project"
  - "Only high-severity issues" → severityFilter = ["High"]
  - Do NOT use for gas analysis (use evm_analyze_gas_profile instead)

Error Handling:
  - Returns isError=true if the path does not exist or Slither is not installed/crashes
  - Returns empty findings array if no vulnerabilities found`,
    inputSchema: {
      contractPath: z
        .string()
        .min(1, "contractPath is required")
        .describe("Absolute path to the Solidity file or Foundry project root"),
      severityFilter: z
        .array(z.enum(SEVERITY_LEVELS))
        .optional()
        .describe("Only return findings at these severities"),
      maxFindings: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Cap the number of findings returned"),
    },
    outputSchema: {
      findings: z.array(SanitizedFindingSchema),
      totalFindings: z.number(),
      truncated: z.boolean(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({
    contractPath,
    severityFilter,
    maxFindings,
  }: {
    contractPath: string;
    severityFilter?: (typeof SEVERITY_LEVELS)[number][];
    maxFindings?: number;
  }) => {
    if (!fs.existsSync(contractPath)) {
      return errorResult(
        `Error: contractPath does not exist: ${contractPath}. Provide an absolute path to a Solidity file or Foundry project root.`
      );
    }
    // Snippet extraction root: Slither reports filename_relative against its
    // working directory, so run it from the project root and reuse that root.
    const projectRoot = fs.statSync(contractPath).isDirectory()
      ? contractPath
      : path.dirname(contractPath);

    let rawJsonOutput = "";
    try {
      const { stdout } = await execFileAsync(
        "slither",
        [contractPath, "--json", "-"],
        { cwd: projectRoot, maxBuffer: MAX_BUFFER }
      );
      rawJsonOutput = stdout;
    } catch (error: unknown) {
      // Slither exits non-zero when findings exist; the JSON is still on stdout.
      const err = error as { stdout?: string; message?: string };
      if (err.stdout) {
        rawJsonOutput = err.stdout;
      } else if (isEnoent(error)) {
        return errorResult(
          "Error: Slither not found. Install with: pip3 install slither-analyzer"
        );
      } else {
        return errorResult(
          `Error: Slither crashed. Details: ${err.message ?? "unknown"}`
        );
      }
    }

    const parsedResult = parseSlitherOutput(rawJsonOutput, projectRoot);
    if (!parsedResult.success) {
      return errorResult(
        `Error: Failed to parse Slither output. ${parsedResult.error}`
      );
    }

    let findings = parsedResult.findings ?? [];
    if (severityFilter && severityFilter.length > 0) {
      const allowed = new Set<string>(severityFilter);
      findings = findings.filter((f) => allowed.has(f.severity));
    }
    const totalBeforeCap = findings.length;
    if (maxFindings !== undefined && findings.length > maxFindings) {
      findings = findings.slice(0, maxFindings);
    }

    const payload = buildScanPayload(findings);
    payload.totalFindings = totalBeforeCap;
    payload.truncated =
      payload.truncated || totalBeforeCap > payload.findings.length;

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(payload, null, 2) },
      ],
      structuredContent: payload,
    };
  }
);

// ---------------------------------------------------------------------------
// Tool 2: evm_analyze_gas_profile
// ---------------------------------------------------------------------------
server.registerTool(
  "evm_analyze_gas_profile",
  {
    title: "Analyze EVM Gas Profile",
    description: `Run forge test --gas-report and return structured gas consumption data per contract and function.

Args:
  - projectPath (string): Absolute path to a Foundry project (must contain foundry.toml)

Returns:
  JSON object:
  {
    "contracts": [
      {
        "name": string,           // e.g. "src/Token.sol:Token"
        "deploymentCost": number, // Gas used for deployment
        "deploymentSize": number, // Bytecode size in bytes
        "functions": [
          {
            "name": string,       // Function name
            "min": number,        // Minimum gas
            "avg": number,        // Average gas
            "median": number,     // Median gas
            "max": number,        // Maximum gas
            "calls": number       // Number of calls in tests
          }
        ]
      }
    ]
  }

Examples:
  - "Show gas usage for my project" → projectPath = "/path/to/foundry-project"
  - Do NOT use for security auditing (use evm_scan_vulnerabilities instead)

Error Handling:
  - Returns isError=true if Foundry is not installed or tests fail to compile`,
    inputSchema: {
      projectPath: z
        .string()
        .min(1, "projectPath is required")
        .describe("Absolute path to the Foundry project root"),
    },
    outputSchema: {
      contracts: z.array(ContractGasSchema),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ projectPath }: { projectPath: string }) => {
    if (!fs.existsSync(projectPath)) {
      return errorResult(
        `Error: projectPath does not exist: ${projectPath}. Provide an absolute path to a Foundry project root.`
      );
    }
    try {
      const { stdout } = await execFileAsync(
        "forge",
        ["test", "--gas-report"],
        { cwd: projectPath, maxBuffer: MAX_BUFFER }
      );
      const parsedResult = parseForgeGasReport(stdout);

      if (!parsedResult.success) {
        return errorResult(`Error: ${parsedResult.error}`);
      }

      const payload = { contracts: parsedResult.contracts ?? [] };
      return {
        content: [
          {
            type: "text" as const,
            text: truncateIfNeeded(JSON.stringify(payload, null, 2)),
          },
        ],
        structuredContent: payload,
      };
    } catch (error: unknown) {
      if (isEnoent(error)) {
        return errorResult(
          "Error: Forge not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash"
        );
      }
      const err = error as { message?: string; stdout?: string };
      return errorResult(
        `Error: Forge execution failed. ${err.message ?? ""}\n${err.stdout ?? ""}`
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Tool 3: evm_compile_and_diagnose
// ---------------------------------------------------------------------------
server.registerTool(
  "evm_compile_and_diagnose",
  {
    title: "Compile & Diagnose Solidity",
    description: `Run forge build and return structured compiler diagnostics.

If compilation succeeds, returns { "success": true, "diagnostics": [] }.
If compilation fails, parses the error output into a JSON array of diagnostics.

Args:
  - projectPath (string): Absolute path to the Foundry project

Returns:
  {
    "success": boolean,     // true if the project compiled cleanly
    "diagnostics": [
      {
        "file": string,      // e.g. "src/Token.sol"
        "line": number,      // Line number (1-indexed)
        "column": number,    // Column number (1-indexed)
        "message": string,   // Compiler error message
        "snippet": string    // Code snippet around the error
      }
    ]
  }

Examples:
  - "Check if my contracts compile" → projectPath = "/path/to/project"
  - "Fix the compilation error" → call this tool, read the diagnostics, fix the file

Error Handling:
  - Returns isError=true if forge is not installed`,
    inputSchema: {
      projectPath: z
        .string()
        .min(1, "projectPath is required")
        .describe("Absolute path to the Foundry project root"),
    },
    outputSchema: {
      success: z.boolean(),
      diagnostics: z.array(CompilerDiagnosticSchema),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ projectPath }: { projectPath: string }) => {
    if (!fs.existsSync(projectPath)) {
      return errorResult(
        `Error: projectPath does not exist: ${projectPath}. Provide an absolute path to a Foundry project root.`
      );
    }
    try {
      await execFileAsync("forge", ["build"], {
        cwd: projectPath,
        maxBuffer: MAX_BUFFER,
      });
      const payload = { success: true, diagnostics: [] };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(payload, null, 2) },
        ],
        structuredContent: payload,
      };
    } catch (error: unknown) {
      if (isEnoent(error)) {
        return errorResult(
          "Error: Forge not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash"
        );
      }
      const err = error as { stdout?: string; message?: string };
      const parsedResult = parseForgeBuildOutput(
        err.stdout || err.message || ""
      );

      if (!parsedResult.success) {
        return errorResult(
          `Error: Could not parse compiler output. ${parsedResult.error}`
        );
      }
      // Compilation failed — success reflects the build, not the parse.
      const payload = {
        success: false,
        diagnostics: parsedResult.diagnostics ?? [],
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(payload, null, 2) },
        ],
        structuredContent: payload,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool 4: evm_simulate_transaction
// ---------------------------------------------------------------------------
server.registerTool(
  "evm_simulate_transaction",
  {
    title: "Simulate EVM Transaction",
    description: `Execute a read-only call against an EVM node using Foundry cast and return decoded results or revert reasons.

This tool does NOT submit a real transaction; it simulates via eth_call.

Args:
  - target (string): Target contract address (0x-prefixed, 42 chars)
  - signature (string): Function signature, e.g. "balanceOf(address)"
  - args (string, optional): Space-separated arguments for the function call
  - rpcUrl (string): JSON-RPC endpoint URL (e.g. http://localhost:8545)

Returns:
  {
    "success": boolean,
    "returnData": string,     // Hex-encoded return data (on success)
    "revertReason": string,   // Decoded revert string (on failure)
    "error": string           // Raw error message (on execution failure)
  }

Examples:
  - "Check the balance of 0xabc..." → target=contract, signature="balanceOf(address)", args="0xabc..."
  - "Call the owner() function" → target=contract, signature="owner()", rpcUrl="http://localhost:8545"

Error Handling:
  - Returns { success: false, revertReason } if the call reverts
  - Returns { success: false, error } if cast is not installed or RPC is unreachable`,
    inputSchema: {
      target: z
        .string()
        .regex(
          /^0x[0-9a-fA-F]{40}$/,
          "target must be a 0x-prefixed 20-byte hex address"
        )
        .describe("Target contract address (0x-prefixed, 42 chars)"),
      signature: z
        .string()
        .min(1, "function signature is required")
        .describe("Function signature, e.g. 'balanceOf(address)'"),
      args: z
        .string()
        .optional()
        .describe("Space-separated arguments for the function call"),
      rpcUrl: z
        .url({ error: "rpcUrl must be a valid URL" })
        .describe("JSON-RPC endpoint URL"),
    },
    outputSchema: SimulatorDiagnosticSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({
    target,
    signature,
    args,
    rpcUrl,
  }: {
    target: string;
    signature: string;
    args?: string;
    rpcUrl: string;
  }) => {
    const argTokens = (args ?? "").split(/\s+/).filter((t) => t.length > 0);
    const castArgs = [
      "call",
      target,
      signature,
      ...argTokens,
      "--rpc-url",
      rpcUrl,
    ];
    let parsedResult;
    try {
      const { stdout } = await execFileAsync("cast", castArgs, {
        maxBuffer: MAX_BUFFER,
      });
      parsedResult = parseCastCallOutput(stdout, "");
    } catch (error: unknown) {
      if (isEnoent(error)) {
        return errorResult(
          "Error: cast not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash"
        );
      }
      const err = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      parsedResult = parseCastCallOutput(
        err.stdout ?? "",
        err.message ?? err.stderr ?? ""
      );
    }
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(parsedResult, null, 2) },
      ],
      structuredContent: parsedResult,
    };
  }
);

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------
function getResourceContent(relativePath: string): string {
  const absolutePath = path.resolve(PKG_ROOT, relativePath);
  if (fs.existsSync(absolutePath)) {
    return fs.readFileSync(absolutePath, "utf-8");
  }
  return `Pattern file not found at ${absolutePath}. The skills/ directory may be missing from this installation.`;
}

server.resource(
  "vulnerabilities",
  "evm://patterns/vulnerabilities",
  { description: "EVM Security Vulnerability Patterns — reentrancy, access control, integer overflow, and more" },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: getResourceContent(
          "./skills/vulnerability-scanning/reference/patterns.md"
        ),
        mimeType: "text/markdown",
      },
    ],
  })
);

server.resource(
  "gas_optimizations",
  "evm://gas/optimizations",
  { description: "EVM Gas Optimization Patterns — storage packing, calldata vs memory, unchecked math" },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: getResourceContent(
          "./skills/gas-optimization/reference/patterns.md"
        ),
        mimeType: "text/markdown",
      },
    ],
  })
);

server.resource(
  "arbitrage_patterns",
  "evm://patterns/arbitrage",
  { description: "EVM Arbitrage Strategies — AMM math, sandwich detection, flash-loan routes" },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: getResourceContent(
          "./skills/arbitrage-analysis/reference/strategies.md"
        ),
        mimeType: "text/markdown",
      },
    ],
  })
);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("evm-agent-toolkit running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
