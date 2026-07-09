import { z } from "zod";
import fsNode from "node:fs";
import pathNode from "node:path";

// ---------------------------------------------------------------------------
// Slither raw output schemas (Zod v4: z.looseObject instead of .passthrough())
// ---------------------------------------------------------------------------
const SlitherElementSchema = z.looseObject({
  type: z.string(),
  name: z.string().optional(),
  source_mapping: z.object({
    lines: z.array(z.number()).optional(),
    filename_relative: z.string().optional()
  }).optional()
});

const SlitherDetectorSchema = z.looseObject({
  check: z.string(),
  impact: z.string(),
  confidence: z.string(),
  description: z.string(),
  elements: z.array(SlitherElementSchema).optional()
});

const SlitherRawOutputSchema = z.looseObject({
  success: z.boolean(),
  error: z.unknown().nullable(),
  results: z.object({
    detectors: z.array(SlitherDetectorSchema)
  }).optional()
});

// ---------------------------------------------------------------------------
// Sanitized output schema for the LLM
// ---------------------------------------------------------------------------
export const SanitizedFindingSchema = z.object({
  check: z.string(),
  severity: z.string(),
  description: z.string(),
  file: z.string().optional(),
  lines: z.array(z.number()).optional(),
  code_snippet: z.string().optional()
});

export type SanitizedFinding = z.infer<typeof SanitizedFindingSchema>;

export interface ParsedSlitherResult {
  success: boolean;
  error?: string;
  findings?: SanitizedFinding[];
}

export function parseSlitherOutput(rawOutput: string, projectPath?: string): ParsedSlitherResult {
  try {
    const parsedJson: unknown = JSON.parse(rawOutput);
    const validated = SlitherRawOutputSchema.parse(parsedJson);

    if (!validated.success || !validated.results) {
      return {
        success: false,
        error: validated.error ? String(validated.error) : "Slither executed but returned no results object."
      };
    }

    const findings: SanitizedFinding[] = validated.results.detectors.map(detector => {
      let file: string | undefined;
      let lines: number[] | undefined;
      let code_snippet: string | undefined;

      if (detector.elements && detector.elements.length > 0) {
        const firstElem = detector.elements[0];
        if (firstElem?.source_mapping) {
          file = firstElem.source_mapping.filename_relative;
          lines = firstElem.source_mapping.lines;
        }
      }

      // Extract the code snippet if we have file, lines, and projectPath
      if (file && lines && lines.length > 0 && projectPath) {
        try {
          const absolutePath = pathNode.resolve(projectPath, file);
          if (fsNode.existsSync(absolutePath)) {
            const fileContent = fsNode.readFileSync(absolutePath, "utf-8");
            const fileLines = fileContent.split("\n");
            const startLine = Math.max(1, lines[0]) - 1;
            const endLine = Math.min(fileLines.length, lines[lines.length - 1] || startLine + 1);
            code_snippet = fileLines.slice(startLine, endLine).join("\n");
          }
        } catch (_e) {
          // Ignore read errors, snippet will remain undefined
        }
      }

      return {
        check: detector.check,
        severity: detector.impact,
        description: detector.description,
        file,
        lines,
        code_snippet
      };
    });

    return { success: true, findings };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to parse Slither output. Raw output might not be JSON. Error: ${message}`
    };
  }
}
