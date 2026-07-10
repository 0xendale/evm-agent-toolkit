import { describe, it, expect } from "vitest";
import { parseVersionOutput } from "../src/tools/versions.js";

describe("Toolchain Version Parser", () => {
  it("should take the first line of multi-line forge output", () => {
    const raw = `forge Version: 1.6.0-nightly
Commit SHA: abcdef123456
Build Timestamp: 2026-07-01T00:00:00Z
`;
    const result = parseVersionOutput("forge", raw);

    expect(result).toEqual({
      tool: "forge",
      installed: true,
      version: "forge Version: 1.6.0-nightly",
    });
  });

  it("should handle slither's bare version string", () => {
    const result = parseVersionOutput("slither", "0.10.4\n");

    expect(result.installed).toBe(true);
    expect(result.version).toBe("0.10.4");
  });

  it("should skip leading blank lines", () => {
    const result = parseVersionOutput("cast", "\n\ncast Version: 1.6.0\n");

    expect(result.version).toBe("cast Version: 1.6.0");
  });

  it("should report not installed for empty output", () => {
    const result = parseVersionOutput("slither", "");

    expect(result).toEqual({ tool: "slither", installed: false });
  });
});
