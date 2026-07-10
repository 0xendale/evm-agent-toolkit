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
import { parseForgeStorageLayout, StorageEntrySchema } from "../tools/storage.js";
import { parseCastTrace, TraceEventSchema } from "../tools/trace.js";
import { parseCastDecodeOutput } from "../tools/decoder.js";
import { parseForgeTestOutput, TestSuiteSchema } from "../tools/testrunner.js";
import { parseVersionOutput, ToolVersionSchema } from "../tools/versions.js";

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
  - detectors (string[], optional): Run only these Slither detector ids (e.g. ["reentrancy-eth", "arbitrary-send-eth"]) for a focused scan

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
      detectors: z
        .array(
          z
            .string()
            .regex(
              /^[a-z0-9-]+$/,
              "detector ids are lowercase kebab-case, e.g. 'reentrancy-eth'"
            )
        )
        .optional()
        .describe("Run only these Slither detector ids"),
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
    detectors,
  }: {
    contractPath: string;
    severityFilter?: (typeof SEVERITY_LEVELS)[number][];
    maxFindings?: number;
    detectors?: string[];
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
      const slitherArgs = [contractPath, "--json", "-"];
      if (detectors && detectors.length > 0) {
        slitherArgs.push("--detect", detectors.join(","));
      }
      const { stdout } = await execFileAsync("slither", slitherArgs, {
        cwd: projectRoot,
        maxBuffer: MAX_BUFFER,
      });
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
// Tool 5: evm_inspect_storage_layout
// ---------------------------------------------------------------------------
server.registerTool(
  "evm_inspect_storage_layout",
  {
    title: "Inspect Contract Storage Layout",
    description: `Run forge inspect <contract> storage-layout and return the resolved storage slot assignment for every state variable.

Essential for proxy-upgrade safety checks (storage-layout collisions) and storage-packing gas analysis.

Args:
  - projectPath (string): Absolute path to the Foundry project root
  - contractName (string): Contract name (e.g. "Token") or fully qualified name (e.g. "src/Token.sol:Token")

Returns:
  JSON object:
  {
    "entries": [
      {
        "label": string,   // State variable name
        "slot": number,    // Storage slot index
        "offset": number,  // Byte offset within the slot
        "type": string,    // Human-readable type (e.g. "address", "mapping(address => uint256)")
        "bytes": number    // Size of the variable in bytes
      }
    ]
  }

Examples:
  - "Check storage layout of my proxy implementation" → contractName = "TokenV2"
  - "Will upgrading V1 to V2 corrupt storage?" → call once per contract, compare entries

Error Handling:
  - Returns isError=true if forge is not installed, the project path is invalid, or the contract is not found`,
    inputSchema: {
      projectPath: z
        .string()
        .min(1, "projectPath is required")
        .describe("Absolute path to the Foundry project root"),
      contractName: z
        .string()
        .regex(
          /^[A-Za-z0-9_./:-]+$/,
          "contractName may contain only letters, digits, and _ . / : -"
        )
        .describe(
          "Contract name (e.g. 'Token') or fully qualified name (e.g. 'src/Token.sol:Token')"
        ),
    },
    outputSchema: {
      entries: z.array(StorageEntrySchema),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({
    projectPath,
    contractName,
  }: {
    projectPath: string;
    contractName: string;
  }) => {
    if (!fs.existsSync(projectPath)) {
      return errorResult(
        `Error: projectPath does not exist: ${projectPath}. Provide an absolute path to a Foundry project root.`
      );
    }
    try {
      const { stdout } = await execFileAsync(
        "forge",
        ["inspect", contractName, "storage-layout", "--json"],
        { cwd: projectPath, maxBuffer: MAX_BUFFER }
      );
      const parsedResult = parseForgeStorageLayout(stdout);
      if (!parsedResult.success) {
        return errorResult(`Error: ${parsedResult.error}`);
      }
      const payload = { entries: parsedResult.entries ?? [] };
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
      const err = error as { message?: string; stderr?: string };
      return errorResult(
        `Error: forge inspect failed. Check that the contract name exists in the project. ${err.stderr ?? err.message ?? ""}`
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Tool 6: evm_trace_call
// ---------------------------------------------------------------------------
server.registerTool(
  "evm_trace_call",
  {
    title: "Trace EVM Call",
    description: `Execute a read-only call with cast call --trace and return the structured call tree: every internal call, its gas cost, call type, return values, emitted events, and revert frames.

Use this to verify exploit reachability, inspect cross-contract call flows, or debug unexpected reverts. This tool does NOT submit a real transaction.

Args:
  - target (string): Target contract address (0x-prefixed, 42 chars)
  - signature (string): Function signature, e.g. "withdraw(uint256)"
  - args (string, optional): Space-separated arguments for the function call
  - rpcUrl (string): JSON-RPC endpoint URL (e.g. http://localhost:8545)

Returns:
  JSON object:
  {
    "reverted": boolean,        // true if any frame reverted
    "gasUsed": number,          // Total gas used (when reported)
    "events": [
      {
        "depth": number,        // Nesting depth in the call tree (0 = top frame)
        "kind": string,         // "call" | "return" | "stop" | "revert" | "emit"
        "gas": number,          // Gas for call frames
        "target": string,       // Callee address or label
        "call": string,         // Function + arguments
        "callType": string,     // "staticcall" | "delegatecall" | undefined (regular call)
        "value": string         // Return data, revert reason, or event payload
      }
    ]
  }

Examples:
  - "Why does withdraw() revert?" → trace it, read the deepest revert frame
  - "Does transfer() call an external contract?" → look for depth > 0 call events

Error Handling:
  - Returns isError=true if cast is not installed, the RPC is unreachable, or no trace was produced`,
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
        .describe("Function signature, e.g. 'withdraw(uint256)'"),
      args: z
        .string()
        .optional()
        .describe("Space-separated arguments for the function call"),
      rpcUrl: z
        .url({ error: "rpcUrl must be a valid URL" })
        .describe("JSON-RPC endpoint URL"),
    },
    outputSchema: {
      reverted: z.boolean(),
      gasUsed: z.number().optional(),
      events: z.array(TraceEventSchema),
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
    const argTokens = (args ?? "").split(/\s+/).filter((t) => t.length > 0);
    let rawOutput = "";
    try {
      const { stdout } = await execFileAsync(
        "cast",
        ["call", target, signature, ...argTokens, "--trace", "--rpc-url", rpcUrl],
        { maxBuffer: MAX_BUFFER }
      );
      rawOutput = stdout;
    } catch (error: unknown) {
      if (isEnoent(error)) {
        return errorResult(
          "Error: cast not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash"
        );
      }
      // Reverted calls exit non-zero but still print the trace.
      const err = error as { stdout?: string; stderr?: string; message?: string };
      if (err.stdout && err.stdout.includes("Traces:")) {
        rawOutput = err.stdout;
      } else {
        return errorResult(
          `Error: cast call --trace failed. Check the RPC endpoint. ${err.message ?? err.stderr ?? ""}`
        );
      }
    }

    const parsedResult = parseCastTrace(rawOutput);
    if (!parsedResult.success) {
      return errorResult(`Error: ${parsedResult.error}`);
    }
    const payload = {
      reverted: parsedResult.reverted ?? false,
      gasUsed: parsedResult.gasUsed,
      events: parsedResult.events ?? [],
    };
    return {
      content: [
        {
          type: "text" as const,
          text: truncateIfNeeded(JSON.stringify(payload, null, 2)),
        },
      ],
      structuredContent: payload,
    };
  }
);

// ---------------------------------------------------------------------------
// Tool 7: evm_decode_calldata
// ---------------------------------------------------------------------------
server.registerTool(
  "evm_decode_calldata",
  {
    title: "Decode EVM Calldata",
    description: `Decode hex calldata into a function signature and typed argument values using Foundry cast.

If you know the function signature, pass it for a fully offline, deterministic decode (cast calldata-decode). Without a signature, the 4-byte selector is resolved via the openchain.xyz signature database (cast 4byte-decode) — requires network access.

Args:
  - calldata (string): Hex-encoded calldata (0x-prefixed, at least the 4-byte selector)
  - signature (string, optional): Known function signature, e.g. "transfer(address,uint256)"

Returns:
  JSON object:
  {
    "success": boolean,
    "signature": string,   // Resolved or provided function signature
    "values": string[]     // Decoded argument values, one per parameter
  }

Examples:
  - "What does this pending tx do?" → calldata = "0xa9059cbb000...", no signature
  - "Decode this transfer call" → calldata + signature = "transfer(address,uint256)"

Error Handling:
  - Returns isError=true if cast is not installed, the calldata is malformed, or the selector is unknown`,
    inputSchema: {
      calldata: z
        .string()
        .regex(
          /^0x[0-9a-fA-F]{8,}$/,
          "calldata must be 0x-prefixed hex with at least a 4-byte selector"
        )
        .describe("Hex-encoded calldata (0x-prefixed)"),
      signature: z
        .string()
        .optional()
        .describe(
          "Known function signature for offline decoding, e.g. 'transfer(address,uint256)'"
        ),
    },
    outputSchema: {
      success: z.boolean(),
      signature: z.string().optional(),
      values: z.array(z.string()).optional(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({
    calldata,
    signature,
  }: {
    calldata: string;
    signature?: string;
  }) => {
    const castArgs = signature
      ? ["calldata-decode", signature, calldata]
      : ["4byte-decode", calldata];
    try {
      const { stdout } = await execFileAsync("cast", castArgs, {
        maxBuffer: MAX_BUFFER,
      });
      const parsedResult = parseCastDecodeOutput(stdout, signature);
      if (!parsedResult.success) {
        return errorResult(`Error: ${parsedResult.error}`);
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(parsedResult, null, 2),
          },
        ],
        structuredContent: parsedResult,
      };
    } catch (error: unknown) {
      if (isEnoent(error)) {
        return errorResult(
          "Error: cast not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash"
        );
      }
      const err = error as { message?: string; stderr?: string };
      return errorResult(
        `Error: calldata decode failed. ${signature ? "Check the signature matches the calldata." : "Selector may be unknown to the signature database; provide a signature for offline decoding."} ${err.stderr ?? err.message ?? ""}`
      );
    }
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
// Tool 8: evm_run_tests
// ---------------------------------------------------------------------------
server.registerTool(
  "evm_run_tests",
  {
    title: "Run Foundry Tests",
    description: `Run forge test and return structured per-suite, per-test results — including fuzz runs and the exact counterexample calldata for failing fuzz/invariant tests.

Use this to verify behavior equivalence after a rewrite, run invariant suites, or drive a Generate-Repair-Execute proof-of-concept loop.

Args:
  - projectPath (string): Absolute path to the Foundry project root
  - matchTest (string, optional): Only run test functions matching this regex (forge --match-test)
  - matchPath (string, optional): Only run test files matching this glob (forge --match-path)

Returns:
  JSON object:
  {
    "allPassed": boolean,
    "totalPassed": number,
    "totalFailed": number,
    "totalSkipped": number,
    "suites": [
      {
        "name": string,          // e.g. "test/Vault.t.sol:VaultTest"
        "passed": number, "failed": number, "skipped": number,
        "tests": [
          {
            "name": string,            // e.g. "testFuzz_withdraw(uint256)"
            "status": string,          // "pass" | "fail" | "skip"
            "reason": string,          // Failure reason (on fail)
            "counterexample": string,  // Fuzz counterexample calldata + args (on fuzz fail)
            "gas": number,             // Gas for unit tests
            "fuzzRuns": number,        // Runs for fuzz/invariant tests
            "medianGas": number        // Median gas for fuzz tests
          }
        ]
      }
    ]
  }

Examples:
  - "Do my invariant tests still hold?" → matchTest = "invariant"
  - "Verify the refactor didn't break Vault" → matchPath = "test/Vault.t.sol"

Error Handling:
  - Returns isError=true if forge is not installed, the path is invalid, or compilation fails (use evm_compile_and_diagnose for compiler errors)`,
    inputSchema: {
      projectPath: z
        .string()
        .min(1, "projectPath is required")
        .describe("Absolute path to the Foundry project root"),
      matchTest: z
        .string()
        .optional()
        .describe("Only run test functions matching this regex"),
      matchPath: z
        .string()
        .optional()
        .describe("Only run test files matching this glob"),
    },
    outputSchema: {
      allPassed: z.boolean(),
      totalPassed: z.number(),
      totalFailed: z.number(),
      totalSkipped: z.number(),
      suites: z.array(TestSuiteSchema),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({
    projectPath,
    matchTest,
    matchPath,
  }: {
    projectPath: string;
    matchTest?: string;
    matchPath?: string;
  }) => {
    if (!fs.existsSync(projectPath)) {
      return errorResult(
        `Error: projectPath does not exist: ${projectPath}. Provide an absolute path to a Foundry project root.`
      );
    }
    const forgeArgs = ["test"];
    if (matchTest) forgeArgs.push("--match-test", matchTest);
    if (matchPath) forgeArgs.push("--match-path", matchPath);

    let rawOutput = "";
    try {
      const { stdout } = await execFileAsync("forge", forgeArgs, {
        cwd: projectPath,
        maxBuffer: MAX_BUFFER,
      });
      rawOutput = stdout;
    } catch (error: unknown) {
      if (isEnoent(error)) {
        return errorResult(
          "Error: Forge not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash"
        );
      }
      // forge test exits non-zero when tests fail; the report is on stdout.
      const err = error as { stdout?: string; message?: string };
      if (err.stdout) {
        rawOutput = err.stdout;
      } else {
        return errorResult(
          `Error: forge test failed to run. ${err.message ?? ""}`
        );
      }
    }

    const parsedResult = parseForgeTestOutput(rawOutput);
    if (!parsedResult.success) {
      return errorResult(`Error: ${parsedResult.error}`);
    }
    const payload = {
      allPassed: parsedResult.allPassed ?? false,
      totalPassed: parsedResult.totalPassed ?? 0,
      totalFailed: parsedResult.totalFailed ?? 0,
      totalSkipped: parsedResult.totalSkipped ?? 0,
      suites: parsedResult.suites ?? [],
    };
    return {
      content: [
        {
          type: "text" as const,
          text: truncateIfNeeded(JSON.stringify(payload, null, 2)),
        },
      ],
      structuredContent: payload,
    };
  }
);

// ---------------------------------------------------------------------------
// Tool 9: evm_toolchain_versions
// ---------------------------------------------------------------------------
server.registerTool(
  "evm_toolchain_versions",
  {
    title: "EVM Toolchain Versions",
    description: `Report which host toolchain binaries (slither, forge, cast) are installed and their exact versions.

Call this once before an analysis session to (a) verify prerequisites and (b) record versions so findings are reproducible — Slither detector sets and forge gas accounting change between releases.

Args: none

Returns:
  JSON object:
  {
    "tools": [
      {
        "tool": string,        // "slither" | "forge" | "cast"
        "installed": boolean,
        "version": string      // First line of --version output (when installed)
      }
    ]
  }

Error Handling:
  - Never errors; missing binaries are reported as installed: false`,
    inputSchema: {},
    outputSchema: {
      tools: z.array(ToolVersionSchema),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const binaries = ["slither", "forge", "cast"];
    const tools = await Promise.all(
      binaries.map(async (tool) => {
        try {
          const { stdout } = await execFileAsync(tool, ["--version"], {
            maxBuffer: MAX_BUFFER,
          });
          return parseVersionOutput(tool, stdout);
        } catch {
          return { tool, installed: false };
        }
      })
    );
    const payload = { tools };
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(payload, null, 2) },
      ],
      structuredContent: payload,
    };
  }
);

// ---------------------------------------------------------------------------
// Prompts — expose the skill workflows to MCP clients without native skill
// support. Each prompt embeds the full SKILL.md so the agent follows the same
// confirm-before-report discipline as Claude Code skill users.
// ---------------------------------------------------------------------------
function skillPromptMessages(skillName: string, taskLine: string) {
  const skillText = getResourceContent(`./skills/${skillName}/SKILL.md`);
  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `${taskLine}\n\nFollow this workflow exactly:\n\n${skillText}`,
        },
      },
    ],
  };
}

server.registerPrompt(
  "audit_contract",
  {
    title: "Audit EVM Contract",
    description:
      "Severity-rated security audit of a Solidity contract following the vulnerability-scanning workflow (pattern seek → confirm reachability → report). Uses evm_scan_vulnerabilities, evm_trace_call, and evm_inspect_storage_layout.",
    argsSchema: {
      contractPath: z
        .string()
        .describe("Absolute path to the Solidity file or Foundry project root"),
    },
  },
  ({ contractPath }: { contractPath: string }) =>
    skillPromptMessages(
      "vulnerability-scanning",
      `Audit the contract at ${contractPath} for security vulnerabilities and produce a severity-rated finding report.`
    )
);

server.registerPrompt(
  "optimize_gas",
  {
    title: "Optimize Contract Gas",
    description:
      "Measured gas-optimization pass following the gas-optimization workflow (one rewrite at a time, security + equivalence + measurement proofs). Uses evm_analyze_gas_profile, evm_scan_vulnerabilities, and evm_inspect_storage_layout.",
    argsSchema: {
      projectPath: z
        .string()
        .describe("Absolute path to the Foundry project root"),
    },
  },
  ({ projectPath }: { projectPath: string }) =>
    skillPromptMessages(
      "gas-optimization",
      `Reduce the gas costs of the contracts in the Foundry project at ${projectPath}. Measure every claimed saving.`
    )
);

server.registerPrompt(
  "analyze_arbitrage",
  {
    title: "Analyze Arbitrage Opportunity",
    description:
      "Quantify a DeFi price dislocation net of fees, gas, slippage, and bribes following the arbitrage-analysis workflow. Analysis only — no trade execution. Uses evm_simulate_transaction, evm_trace_call, and evm_decode_calldata.",
    argsSchema: {
      scenario: z
        .string()
        .describe(
          "The opportunity to analyze: venues, pair, observed prices/spread, and trade size of interest"
        ),
    },
  },
  ({ scenario }: { scenario: string }) =>
    skillPromptMessages(
      "arbitrage-analysis",
      `Analyze this potential arbitrage opportunity and produce an opportunity ledger: ${scenario}`
    )
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
