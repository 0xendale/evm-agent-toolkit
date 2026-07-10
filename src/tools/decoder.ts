import { z } from "zod";

// ---------------------------------------------------------------------------
// cast calldata-decode / cast 4byte-decode output parser
//
// `cast calldata-decode "transfer(address,uint256)" 0xa9059cbb...` prints one
// decoded value per line:
//   0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B
//   100000000000000000000
//
// `cast 4byte-decode 0xa9059cbb...` prints the resolved signature first:
//   1) "transfer(address,uint256)"
//   0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B
//   100000000000000000000
// ---------------------------------------------------------------------------

export const DecodedCalldataSchema = z.object({
  success: z.boolean(),
  signature: z.string().optional(),
  values: z.array(z.string()).optional(),
  error: z.string().optional(),
});

export type DecodedCalldata = z.infer<typeof DecodedCalldataSchema>;

const SIGNATURE_LINE = /^\d+\)\s+"(.+)"$/;

export function parseCastDecodeOutput(
  rawOutput: string,
  knownSignature?: string
): DecodedCalldata {
  const lines = rawOutput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      success: false,
      error: "cast produced no output for the given calldata.",
    };
  }

  let signature = knownSignature;
  const values: string[] = [];

  for (const line of lines) {
    const sigMatch = line.match(SIGNATURE_LINE);
    if (sigMatch) {
      // First resolved signature wins; deterministic across runs.
      if (!signature) signature = sigMatch[1];
      continue;
    }
    values.push(line);
  }

  return { success: true, signature, values };
}
