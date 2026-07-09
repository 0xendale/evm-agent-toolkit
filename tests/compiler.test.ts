import { describe, it, expect } from "vitest";
import { parseForgeBuildOutput } from "../src/tools/compiler.js";

describe("Compiler Diagnostics Parser", () => {
  it("should successfully parse standard forge build errors", () => {
    const rawOutput = `
Compiling 1 files with 0.8.19
Compiler run failed:
Error (6275): Expected ';' but got '}'
 --> src/Contract.sol:15:5:
   |
15 |     return 1
   |             ^

Error (1234): Undeclared identifier
 --> src/Token.sol:20:10:
   |
20 |     emit Transfer(address(0), msg.sender, 100);
   |          ^^^^^^^^
    `;

    const result = parseForgeBuildOutput(rawOutput);

    expect(result.success).toBe(true);
    expect(result.diagnostics?.length).toBe(2);

    const error1 = result.diagnostics![0];
    expect(error1.file).toBe("src/Contract.sol");
    expect(error1.line).toBe(15);
    expect(error1.column).toBe(5);
    expect(error1.message).toBe("Error (6275): Expected ';' but got '}'");
    expect(error1.snippet).toContain("return 1");

    const error2 = result.diagnostics![1];
    expect(error2.file).toBe("src/Token.sol");
    expect(error2.line).toBe(20);
    expect(error2.column).toBe(10);
  });

  it("should handle unparseable errors", () => {
    const rawOutput = "Compiler run failed with unknown error code ABC";
    const result = parseForgeBuildOutput(rawOutput);

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "Compiler failed but could not parse specific errors",
    );
  });

  it("should return success with 0 diagnostics if build passes", () => {
    const rawOutput = "Compiling 1 files with 0.8.19\nBuild successful.";
    const result = parseForgeBuildOutput(rawOutput);

    expect(result.success).toBe(true);
    expect(result.diagnostics?.length).toBe(0);
  });
});
