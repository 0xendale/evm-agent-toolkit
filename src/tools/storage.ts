import { z } from "zod";

// ---------------------------------------------------------------------------
// forge inspect <contract> storage-layout --json raw schemas
// ---------------------------------------------------------------------------
const RawStorageSlotSchema = z.looseObject({
  label: z.string(),
  offset: z.number(),
  slot: z.string(),
  type: z.string(),
  contract: z.string().optional(),
});

const RawTypeSchema = z.looseObject({
  label: z.string(),
  numberOfBytes: z.string(),
  encoding: z.string().optional(),
});

const RawStorageLayoutSchema = z.looseObject({
  storage: z.array(RawStorageSlotSchema),
  types: z.record(z.string(), RawTypeSchema).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Sanitized output schema for the LLM
// ---------------------------------------------------------------------------
export const StorageEntrySchema = z.object({
  label: z.string(),
  slot: z.number(),
  offset: z.number(),
  type: z.string(),
  bytes: z.number(),
});

export type StorageEntry = z.infer<typeof StorageEntrySchema>;

export interface ParsedStorageLayoutResult {
  success: boolean;
  error?: string;
  entries?: StorageEntry[];
}

export function parseForgeStorageLayout(
  rawOutput: string
): ParsedStorageLayoutResult {
  try {
    const parsedJson: unknown = JSON.parse(rawOutput);
    const validated = RawStorageLayoutSchema.parse(parsedJson);

    const types = validated.types ?? {};
    const entries: StorageEntry[] = validated.storage.map((slot) => {
      const typeInfo = types[slot.type];
      return {
        label: slot.label,
        slot: parseInt(slot.slot, 10),
        offset: slot.offset,
        type: typeInfo?.label ?? slot.type,
        bytes: typeInfo ? parseInt(typeInfo.numberOfBytes, 10) : 0,
      };
    });

    return { success: true, entries };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to parse forge storage layout output. Error: ${message}`,
    };
  }
}
