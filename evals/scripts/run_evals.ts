#!/usr/bin/env node

/**
 * EVM Skills Hub - Eval Runner
 * 
 * This script is designed to evaluate an LLM's success rate using our MCP server.
 * 
 * Flow:
 * 1. Takes a vulnerable contract (e.g. src/ReentrancyVault.sol).
 * 2. Prompts the agent via API to "Audit and fix this contract using your tools".
 * 3. The agent uses the `scan_vulnerabilities` MCP tool, applies the fix, and saves it.
 * 4. This script runs Slither again on the fixed file to verify it passes (0 criticals).
 * 5. Records a PASS/FAIL in the eval benchmark logs.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(exec);

async function runEval() {
  console.log("🚀 Starting Eval: ReentrancyVault.sol");
  console.log("-----------------------------------------");

  // Step 1: Pre-Audit Baseline
  console.log("Checking baseline with Slither...");
  try {
    await execAsync(`slither evals/src/ReentrancyVault.sol`);
    console.log("❌ Baseline failed: Slither found no vulnerabilities in a deliberately vulnerable file.");
    process.exit(1);
  } catch (e: any) {
    if (e.stdout && e.stdout.includes("Reentrancy")) {
      console.log("✅ Baseline passed: Slither correctly identified Reentrancy.");
    }
  }

  console.log("\n[EVAL HALTED]");
  console.log("To complete this eval, configure your LLM API keys in an orchestrator (like LangChain or Antigravity SDK).");
  console.log("The orchestrator should let the LLM use the MCP tools to fix the file, then we re-run the baseline check.");
}

runEval();
