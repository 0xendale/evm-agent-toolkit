import { z } from "zod";

// ---------------------------------------------------------------------------
// cast call --trace output parser
//
// Example input:
//   Traces:
//     [24661] 0x5FbD...aa3::transfer(0xabc..., 100)
//       ├─ [2534] 0x1234...def::balanceOf(0xabc...) [staticcall]
//       │   └─ ← [Return] 100
//       └─ ← [Return] true
//
//   Transaction successfully executed.
//   Gas used: 26394
// ---------------------------------------------------------------------------

export const TraceEventSchema = z.object({
  depth: z.number(),
  kind: z.enum(["call", "return", "stop", "revert", "emit"]),
  gas: z.number().optional(),
  target: z.string().optional(),
  call: z.string().optional(),
  callType: z.string().optional(),
  value: z.string().optional(),
});

export type TraceEvent = z.infer<typeof TraceEventSchema>;

export interface ParsedTraceResult {
  success: boolean;
  error?: string;
  reverted?: boolean;
  gasUsed?: number;
  events?: TraceEvent[];
}

const CALL_LINE =
  /^\[(\d+)\]\s+(0x[0-9a-fA-F]{40}|[\w:.]+)::(.+?)(?:\s+\[(staticcall|delegatecall|callcode)\])?$/;
const RESULT_LINE = /^←\s+\[(Return|Stop|Revert)\]\s*(.*)$/;
const EMIT_LINE = /^emit\s+(.+)$/;

/** Tree glyphs (│ ├─ └─) occupy 4 columns per nesting level. */
function depthOf(indent: string): number {
  return Math.floor(indent.length / 4);
}

export function parseCastTrace(rawOutput: string): ParsedTraceResult {
  if (!rawOutput.includes("Traces:")) {
    return {
      success: false,
      error: `No trace section found in cast output. Raw output: ${rawOutput.slice(0, 500)}`,
    };
  }

  const events: TraceEvent[] = [];
  let reverted = false;
  let gasUsed: number | undefined;

  const lines = rawOutput.split("\n");
  for (const rawLine of lines) {
    const gasMatch = rawLine.match(/^Gas used:\s*(\d+)/);
    if (gasMatch) {
      gasUsed = parseInt(gasMatch[1], 10);
      continue;
    }
    if (rawLine.includes("Transaction failed") || rawLine.includes("Revert")) {
      // Revert detection is finalized per-event below; this catches summaries.
      if (rawLine.trim().startsWith("Error") || rawLine.includes("Transaction failed")) {
        reverted = true;
      }
    }

    // Strip tree glyphs, remember indentation for depth.
    const stripped = rawLine.replace(/[│├└─]/g, " ");
    const content = stripped.trim();
    if (!content) continue;
    const indent = stripped.slice(0, stripped.length - stripped.trimStart().length);

    const callMatch = content.match(CALL_LINE);
    if (callMatch) {
      events.push({
        depth: depthOf(indent),
        kind: "call",
        gas: parseInt(callMatch[1], 10),
        target: callMatch[2],
        call: callMatch[3].trim(),
        callType: callMatch[4],
      });
      continue;
    }

    const resultMatch = content.match(RESULT_LINE);
    if (resultMatch) {
      const kindWord = resultMatch[1].toLowerCase() as "return" | "stop" | "revert";
      if (kindWord === "revert") reverted = true;
      events.push({
        depth: depthOf(indent),
        kind: kindWord,
        value: resultMatch[2].trim() || undefined,
      });
      continue;
    }

    const emitMatch = content.match(EMIT_LINE);
    if (emitMatch) {
      events.push({
        depth: depthOf(indent),
        kind: "emit",
        value: emitMatch[1].trim(),
      });
    }
  }

  if (events.length === 0) {
    return {
      success: false,
      error: `Trace section present but no call frames could be parsed. Raw output: ${rawOutput.slice(0, 500)}`,
    };
  }

  return { success: true, reverted, gasUsed, events };
}
