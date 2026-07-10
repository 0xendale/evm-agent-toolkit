import { describe, it, expect } from "vitest";
import { parseForgeStorageLayout } from "../src/tools/storage.js";

describe("Forge Storage Layout Parser", () => {
  it("should parse a standard storage layout with packed slots", () => {
    const rawOutput = JSON.stringify({
      storage: [
        {
          astId: 3,
          contract: "src/Token.sol:Token",
          label: "owner",
          offset: 0,
          slot: "0",
          type: "t_address",
        },
        {
          astId: 5,
          contract: "src/Token.sol:Token",
          label: "paused",
          offset: 20,
          slot: "0",
          type: "t_bool",
        },
        {
          astId: 9,
          contract: "src/Token.sol:Token",
          label: "balances",
          offset: 0,
          slot: "1",
          type: "t_mapping(t_address,t_uint256)",
        },
      ],
      types: {
        t_address: { encoding: "inplace", label: "address", numberOfBytes: "20" },
        t_bool: { encoding: "inplace", label: "bool", numberOfBytes: "1" },
        "t_mapping(t_address,t_uint256)": {
          encoding: "mapping",
          label: "mapping(address => uint256)",
          numberOfBytes: "32",
        },
      },
    });

    const result = parseForgeStorageLayout(rawOutput);

    expect(result.success).toBe(true);
    expect(result.entries?.length).toBe(3);

    expect(result.entries![0]).toEqual({
      label: "owner",
      slot: 0,
      offset: 0,
      type: "address",
      bytes: 20,
    });
    expect(result.entries![1]).toEqual({
      label: "paused",
      slot: 0,
      offset: 20,
      type: "bool",
      bytes: 1,
    });
    expect(result.entries![2].type).toBe("mapping(address => uint256)");
    expect(result.entries![2].slot).toBe(1);
  });

  it("should handle a contract with no state variables", () => {
    const rawOutput = JSON.stringify({ storage: [], types: null });

    const result = parseForgeStorageLayout(rawOutput);

    expect(result.success).toBe(true);
    expect(result.entries).toEqual([]);
  });

  it("should fall back to the raw type id when the types map lacks an entry", () => {
    const rawOutput = JSON.stringify({
      storage: [
        { label: "x", offset: 0, slot: "2", type: "t_unknown_thing" },
      ],
      types: {},
    });

    const result = parseForgeStorageLayout(rawOutput);

    expect(result.success).toBe(true);
    expect(result.entries![0].type).toBe("t_unknown_thing");
    expect(result.entries![0].bytes).toBe(0);
  });

  it("should fail gracefully on non-JSON output", () => {
    const result = parseForgeStorageLayout("Error: No contract found");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to parse");
  });
});
