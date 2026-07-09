import { z } from "zod";

export const SimulatorDiagnosticSchema = z.object({
  success: z.boolean(),
  returnData: z.string().optional(),
  revertReason: z.string().optional(),
  error: z.string().optional()
});

export type SimulatorDiagnostic = z.infer<typeof SimulatorDiagnosticSchema>;

export function parseCastCallOutput(rawOutput: string, rawError: string): SimulatorDiagnostic {
  // If cast executed successfully, it prints the return data to stdout
  if (rawOutput && !rawError && !rawOutput.includes("Error") && !rawOutput.includes("reverted")) {
    return {
      success: true,
      returnData: rawOutput.trim()
    };
  }

  // If it reverted, stderr or stdout will contain the revert string
  const combined = (rawOutput + " " + rawError).trim();
  
  // Extract custom error or revert string
  const revertMatch = combined.match(/reverted with custom error '([^']+)'/i) || 
                      combined.match(/revert:([^$]+)/i) ||
                      combined.match(/reverted:([^$]+)/i) ||
                      combined.match(/reverted with reason string '([^']+)'/i);
                      
  if (revertMatch) {
    return {
      success: false,
      revertReason: revertMatch[1].trim()
    };
  }

  // Generic execution failure
  return {
    success: false,
    error: combined
  };
}
