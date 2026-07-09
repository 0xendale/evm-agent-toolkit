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
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { parseSlitherOutput } from "../tools/slither.js";
import { parseForgeGasReport } from "../tools/forge.js";
import { parseForgeBuildOutput } from "../tools/compiler.js";
import { parseCastCallOutput } from "../tools/simulator.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CHARACTER_LIMIT = 25_000;

function truncateIfNeeded(text: string): string {
  if (text.length > CHARACTER_LIMIT) {
    return (
      text.slice(0, CHARACTER_LIMIT) +
      `\n\n[TRUNCATED] Response exceeded ${CHARACTER_LIMIT} characters. Use filters or pagination to narrow results.`
    );
  }
  return text;
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
server.registerTool(
  "evm_scan_vulnerabilities",
  {
    title: "Scan EVM Vulnerabilities",
    description: `Run Slither static analysis on a Solidity contract and return schema-validated vulnerability findings.

Each finding includes the detector name, severity, description, source file, line numbers, and the actual code snippet extracted from the file system.

Args:
  - contractPath (string): Absolute path to the Solidity file or Foundry project root

Returns:
  JSON array of findings, each with:
  {
    "check": string,        // Slither detector id (e.g. "reentrancy-eth")
    "severity": string,     // "High" | "Medium" | "Low" | "Informational"
    "description": string,  // Human-readable explanation
    "file": string,         // Relative path to the source file
    "lines": number[],      // Affected line numbers (1-indexed)
    "code_snippet": string  // Extracted source code from the file
  }

Examples:
  - "Audit src/Vault.sol for reentrancy" → contractPath = "/path/to/src/Vault.sol"
  - "Run security scan on my Foundry project" → contractPath = "/path/to/project"
  - Do NOT use for gas analysis (use evm_analyze_gas_profile instead)

Error Handling:
  - Returns isError=true if Slither is not installed or crashes
  - Returns empty array if no vulnerabilities found`,
    inputSchema: {
      contractPath: z
        .string()
        .min(1, "contractPath is required")
        .describe("Absolute path to the Solidity file or Foundry project root"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ contractPath }: { contractPath: string }) => {
    let rawJsonOutput = "";
    try {
      const { stdout } = await execAsync(`slither ${contractPath} --json -`);
      rawJsonOutput = stdout;
    } catch (error: unknown) {
      const err = error as { stdout?: string; message?: string };
      if (err.stdout) {
        rawJsonOutput = err.stdout;
      } else {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: Slither not found or crashed. Install with: pip3 install slither-analyzer. Details: ${err.message ?? "unknown"}`,
            },
          ],
        };
      }
    }

    const parsedResult = parseSlitherOutput(rawJsonOutput, process.cwd());
    if (!parsedResult.success) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error: Failed to parse Slither output. ${parsedResult.error}`,
          },
        ],
      };
    }

    const text = truncateIfNeeded(
      JSON.stringify(parsedResult.findings, null, 2)
    );
    return { content: [{ type: "text" as const, text }] };
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
  JSON array of contracts, each with:
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ projectPath }: { projectPath: string }) => {
    try {
      const { stdout } = await execAsync(`forge test --gas-report`, {
        cwd: projectPath,
      });
      const parsedResult = parseForgeGasReport(stdout);

      if (!parsedResult.success) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: ${parsedResult.error}`,
            },
          ],
        };
      }

      const text = truncateIfNeeded(
        JSON.stringify(parsedResult.contracts, null, 2)
      );
      return { content: [{ type: "text" as const, text }] };
    } catch (error: unknown) {
      const err = error as { message?: string; stdout?: string };
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error: Forge execution failed. Ensure Foundry is installed (curl -L https://foundry.paradigm.xyz | bash). ${err.message ?? ""}\n${err.stdout ?? ""}`,
          },
        ],
      };
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
    "success": boolean,
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ projectPath }: { projectPath: string }) => {
    try {
      await execAsync(`forge build`, { cwd: projectPath });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { success: true, diagnostics: [] },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: unknown) {
      const err = error as { stdout?: string; message?: string };
      const parsedResult = parseForgeBuildOutput(
        err.stdout || err.message || ""
      );

      if (!parsedResult.success) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: Could not parse compiler output. ${parsedResult.error}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(parsedResult, null, 2),
          },
        ],
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
        .min(1, "target address is required")
        .describe("Target contract address (0x-prefixed)"),
      signature: z
        .string()
        .min(1, "function signature is required")
        .describe("Function signature, e.g. 'balanceOf(address)'"),
      args: z
        .string()
        .optional()
        .describe("Space-separated arguments for the function call"),
      rpcUrl: z
        .string()
        .min(1, "rpcUrl is required")
        .describe("JSON-RPC endpoint URL"),
    },
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
    const argsStr = args ?? "";
    try {
      const { stdout } = await execAsync(
        `cast call ${target} "${signature}" ${argsStr} --rpc-url ${rpcUrl}`
      );
      const parsedResult = parseCastCallOutput(stdout, "");
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(parsedResult, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const err = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      const parsedResult = parseCastCallOutput(
        err.stdout ?? "",
        err.message ?? err.stderr ?? ""
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(parsedResult, null, 2),
          },
        ],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------
function getResourceContent(relativePath: string): string {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  if (fs.existsSync(absolutePath)) {
    return fs.readFileSync(absolutePath, "utf-8");
  }
  return `Pattern file not found at ${absolutePath}. Ensure the evm-agent-toolkit repository is the working directory.`;
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
