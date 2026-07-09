import { describe, it, expect } from "vitest";
import { parseSlitherOutput } from "../src/tools/slither.js";

describe("Slither Parser Tool", () => {
  it("should successfully parse standard Slither JSON output", () => {
    const rawSlitherJson = JSON.stringify({
      success: true,
      error: null,
      results: {
        detectors: [
          {
            check: "reentrancy-eth",
            impact: "High",
            confidence: "Medium",
            description: "Reentrancy in Contract.withdraw()",
            elements: [
              {
                type: "function",
                name: "withdraw",
                source_mapping: {
                  lines: [10, 20],
                  filename_relative: "src/Contract.sol",
                },
              },
            ],
          },
        ],
      },
    });

    const result = parseSlitherOutput(rawSlitherJson);

    expect(result.success).toBe(true);
    expect(result.findings?.length).toBe(1);
    expect(result.findings?.[0]?.check).toBe("reentrancy-eth");
    expect(result.findings?.[0]?.severity).toBe("High");
    expect(result.findings?.[0]?.file).toBe("src/Contract.sol");
  });

  it("should handle malformed JSON gracefully", () => {
    const rawOutput =
      "Slither crashed with Python Traceback... \n SyntaxError: invalid syntax";
    const result = parseSlitherOutput(rawOutput);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to parse Slither output");
  });

  it("should handle Slither returning no vulnerabilities", () => {
    const rawSlitherJson = JSON.stringify({
      success: true,
      error: null,
      results: {
        detectors: [],
      },
    });

    const result = parseSlitherOutput(rawSlitherJson);
    expect(result.success).toBe(true);
    expect(result.findings?.length).toBe(0);
  });
});
