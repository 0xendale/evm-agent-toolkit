#!/usr/bin/env node

/**
 * EVM Skills Hub - UserPromptSubmit Hook
 * 
 * This script runs right after the user submits a prompt, but BEFORE the agent sees it.
 * It intercepts the prompt via standard input (stdin) or arguments, analyzes it, 
 * and silently appends EVM context directives to guide the agent.
 */

async function interceptPrompt() {
  const userPrompt = process.argv[2] || "";
  let injectedPrompt = userPrompt;

  const lowerPrompt = userPrompt.toLowerCase();

  // If the user asks about gas, secretly append instructions to use our MCP tool
  if (lowerPrompt.includes("gas") || lowerPrompt.includes("optimize")) {
    injectedPrompt += "\n\n[SYSTEM HOOK]: The user is asking about gas optimization. You MUST immediately use the `evm_analyze_gas_profile` tool before answering, and reference `evm://gas/optimizations`.";
  }

  // If the user asks about security or audit
  if (lowerPrompt.includes("audit") || lowerPrompt.includes("vulnerab") || lowerPrompt.includes("hack")) {
    injectedPrompt += "\n\n[SYSTEM HOOK]: The user is asking for a security audit. Do NOT guess. You MUST run the `evm_scan_vulnerabilities` tool and reference `evm://patterns/vulnerabilities` before proceeding.";
  }

  // Output the modified prompt to stdout so the agent runtime can pick it up
  console.log(injectedPrompt);
}

interceptPrompt();
