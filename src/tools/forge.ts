import { z } from "zod";

export const FunctionGasSchema = z.object({
  name: z.string(),
  min: z.number(),
  avg: z.number(),
  median: z.number(),
  max: z.number(),
  calls: z.number()
});

export const ContractGasSchema = z.object({
  name: z.string(),
  deploymentCost: z.number().nullable(),
  deploymentSize: z.number().nullable(),
  functions: z.array(FunctionGasSchema)
});

export type ContractGas = z.infer<typeof ContractGasSchema>;

export type ParsedForgeResult = {
  success: boolean;
  error?: string;
  contracts?: ContractGas[];
};

export function parseForgeGasReport(rawOutput: string): ParsedForgeResult {
  if (rawOutput.includes("Error:") || rawOutput.includes("Compiler run failed") || rawOutput.includes("build failed")) {
    return {
      success: false,
      error: `Failed to build or run forge tests. Raw output: ${rawOutput}`
    };
  }

  const contracts: ContractGas[] = [];
  const lines = rawOutput.split('\n');
  
  let currentContract: ContractGas | null = null;
  let inGasTable = false;
  let parsingFunctions = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Match start of a contract table e.g. "| src/Contract.sol:Contract contract |..."
    if (line.startsWith('|') && line.includes('contract |') && !line.includes('Function Name')) {
      if (currentContract) {
        contracts.push(currentContract);
      }
      const nameMatch = line.match(/\| (.+?) contract \|/);
      currentContract = {
        name: nameMatch ? nameMatch[1].trim() : "Unknown",
        deploymentCost: null,
        deploymentSize: null,
        functions: []
      };
      inGasTable = true;
      parsingFunctions = false;
      continue;
    }

    if (!currentContract || !inGasTable) continue;

    // Parse Deployment Row
    // | 150000 | 1200 | ...
    if (line.match(/^\|\s*\d+\s*\|\s*\d+\s*\|/)) {
      const parts = line.split('|').map(s => s.trim()).filter(s => s.length > 0);
      if (parts.length >= 2 && !parsingFunctions) {
        currentContract.deploymentCost = parseInt(parts[0], 10);
        currentContract.deploymentSize = parseInt(parts[1], 10);
      }
    }

    // Match start of functions
    if (line.includes('| Function Name') && line.includes('min') && line.includes('avg')) {
      parsingFunctions = true;
      continue;
    }

    // Parse Function Row
    if (parsingFunctions && line.startsWith('|') && !line.includes('----')) {
      const parts = line.split('|').map(s => s.trim()).filter(s => s.length > 0);
      if (parts.length >= 6) {
        const name = parts[0];
        // Ensure the rest are numbers (might be '-' for some calls)
        const parseNum = (str: string) => str === '-' ? 0 : parseInt(str, 10);
        
        currentContract.functions.push({
          name,
          min: parseNum(parts[1]),
          avg: parseNum(parts[2]),
          median: parseNum(parts[3]),
          max: parseNum(parts[4]),
          calls: parseNum(parts[5])
        });
      } else {
        // End of table for this contract
        inGasTable = false;
      }
    }
  }

  if (currentContract) {
    contracts.push(currentContract);
  }

  return {
    success: true,
    contracts
  };
}
