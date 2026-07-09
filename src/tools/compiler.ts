import { z } from "zod";

export const CompilerDiagnosticSchema = z.object({
  file: z.string(),
  line: z.number(),
  column: z.number().optional(),
  message: z.string(),
  snippet: z.string().optional()
});

export type CompilerDiagnostic = z.infer<typeof CompilerDiagnosticSchema>;

export type ParsedCompilerResult = {
  success: boolean;
  diagnostics?: CompilerDiagnostic[];
  error?: string;
};

export function parseForgeBuildOutput(rawOutput: string): ParsedCompilerResult {
  const diagnostics: CompilerDiagnostic[] = [];
  
  // Standard forge build error pattern:
  // Error (xxxx): Expected ';' but got '}'
  //  --> src/Contract.sol:15:5:
  
  const blocks = rawOutput.split('Error (');
  
  for (let i = 1; i < blocks.length; i++) { // Skip the first block which is just preface
    const block = blocks[i];
    
    // Extract message
    const lines = block.split('\n');
    let message = "";
    if (lines.length > 0) {
      // Reconstruct "Error (xxxx): Message"
      message = "Error (" + lines[0].trim();
    }
    
    // Extract file, line, column
    let file = "";
    let line = 0;
    let column = 0;
    
    const locationMatch = block.match(/-->\s*(.+?):(\d+):(\d+)/);
    if (locationMatch) {
      file = locationMatch[1];
      line = parseInt(locationMatch[2], 10);
      column = parseInt(locationMatch[3], 10);
    }
    
    if (file && line > 0) {
      // Extract snippet (usually the lines below the arrow)
      const arrowIndex = block.indexOf('-->');
      let snippet = "";
      if (arrowIndex !== -1) {
        snippet = block.substring(arrowIndex).split('\n').slice(1, 5).join('\n').trim();
      }
      
      diagnostics.push({
        file,
        line,
        column,
        message,
        snippet
      });
    }
  }

  // If no blocks were parsed but output contains "Compiler run failed"
  if (diagnostics.length === 0 && rawOutput.includes('Compiler run failed')) {
    return {
      success: false,
      error: `Compiler failed but could not parse specific errors. Raw output: ${rawOutput}`
    };
  }

  return {
    success: true,
    diagnostics
  };
}
