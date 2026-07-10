import { z } from "zod";

// ---------------------------------------------------------------------------
// Toolchain --version output parser
//
// forge/cast print multi-line output ("forge Version: 1.6.0-nightly\nCommit
// SHA: ..."); slither prints a bare version ("0.10.4"). The first non-empty
// stdout line identifies the installed version deterministically.
// ---------------------------------------------------------------------------

export const ToolVersionSchema = z.object({
  tool: z.string(),
  installed: z.boolean(),
  version: z.string().optional(),
});

export type ToolVersion = z.infer<typeof ToolVersionSchema>;

export function parseVersionOutput(tool: string, rawOutput: string): ToolVersion {
  const firstLine = rawOutput
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);

  if (!firstLine) {
    return { tool, installed: false };
  }
  return { tool, installed: true, version: firstLine };
}
