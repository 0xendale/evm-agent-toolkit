#!/usr/bin/env node

/**
 * EVM Skills Hub - Statusline Badge Script
 * 
 * This script is intended to be run periodically by the agent's UI (e.g., Cursor, Antigravity CLI)
 * to render a badge in the statusline. 
 * 
 * Example Output: "⛽ 150k gas | 🛡️ 0 High"
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(exec);

async function generateStatusline() {
  try {
    // Quick check if this is a foundry project
    const isFoundry = require("fs").existsSync("foundry.toml");
    if (!isFoundry) {
      console.log("🦊 Non-EVM");
      return;
    }

    // Try to get a quick gas snapshot (if snapshot file exists, parse it)
    let gasDisplay = "⛽ --";
    try {
      const fs = require("fs");
      if (fs.existsSync(".gas-snapshot")) {
        gasDisplay = "⛽ Snapshotted";
      }
    } catch(e) {}

    console.log(`${gasDisplay} | 🛡️ Ready`);
  } catch (error) {
    console.log("🦊 EVM Error");
  }
}

generateStatusline();
