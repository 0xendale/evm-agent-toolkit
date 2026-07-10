import { describe, it, expect } from "vitest";
import { parseCastDecodeOutput } from "../src/tools/decoder.js";

describe("Cast Decode Output Parser", () => {
  it("should parse calldata-decode output with a known signature", () => {
    const rawOutput = `0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B
100000000000000000000
`;

    const result = parseCastDecodeOutput(
      rawOutput,
      "transfer(address,uint256)"
    );

    expect(result.success).toBe(true);
    expect(result.signature).toBe("transfer(address,uint256)");
    expect(result.values).toEqual([
      "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
      "100000000000000000000",
    ]);
  });

  it("should extract the resolved signature from 4byte-decode output", () => {
    const rawOutput = `1) "transfer(address,uint256)"
0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B
100000000000000000000
`;

    const result = parseCastDecodeOutput(rawOutput);

    expect(result.success).toBe(true);
    expect(result.signature).toBe("transfer(address,uint256)");
    expect(result.values?.length).toBe(2);
  });

  it("should keep the first resolved signature when multiple candidates exist", () => {
    const rawOutput = `1) "transfer(address,uint256)"
2) "gasprice_bit_ether(int128)"
0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B
`;

    const result = parseCastDecodeOutput(rawOutput);

    expect(result.signature).toBe("transfer(address,uint256)");
    expect(result.values).toEqual([
      "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
    ]);
  });

  it("should fail gracefully on empty output", () => {
    const result = parseCastDecodeOutput("");

    expect(result.success).toBe(false);
    expect(result.error).toContain("no output");
  });
});
