import { describe, it, expect } from "vitest";
import { parseCastTrace } from "../src/tools/trace.js";

describe("Cast Trace Parser", () => {
  it("should parse a nested call tree with return values", () => {
    const rawOutput = `
Traces:
  [24661] 0x5FbDB2315678afecb367f032d93F642f64180aa3::transfer(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266, 100)
    ├─ [2534] 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0::balanceOf(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266) [staticcall]
    │   └─ ← [Return] 100
    ├─ emit Transfer(from: 0xf39F..., to: 0x7099..., value: 100)
    └─ ← [Return] true

Transaction successfully executed.
Gas used: 26394
`;

    const result = parseCastTrace(rawOutput);

    expect(result.success).toBe(true);
    expect(result.reverted).toBe(false);
    expect(result.gasUsed).toBe(26394);

    const events = result.events!;
    const calls = events.filter((e) => e.kind === "call");
    expect(calls.length).toBe(2);

    expect(calls[0].gas).toBe(24661);
    expect(calls[0].target).toBe("0x5FbDB2315678afecb367f032d93F642f64180aa3");
    expect(calls[0].call).toContain("transfer(");
    expect(calls[0].callType).toBeUndefined();

    expect(calls[1].gas).toBe(2534);
    expect(calls[1].callType).toBe("staticcall");
    expect(calls[1].depth).toBeGreaterThan(calls[0].depth);

    const emits = events.filter((e) => e.kind === "emit");
    expect(emits.length).toBe(1);
    expect(emits[0].value).toContain("Transfer(");

    const returns = events.filter((e) => e.kind === "return");
    expect(returns.length).toBe(2);
    expect(returns[returns.length - 1].value).toBe("true");
  });

  it("should detect reverted frames", () => {
    const rawOutput = `
Traces:
  [21000] 0x5FbDB2315678afecb367f032d93F642f64180aa3::withdraw(500)
    └─ ← [Revert] InsufficientBalance()
`;

    const result = parseCastTrace(rawOutput);

    expect(result.success).toBe(true);
    expect(result.reverted).toBe(true);
    const revert = result.events!.find((e) => e.kind === "revert");
    expect(revert?.value).toBe("InsufficientBalance()");
  });

  it("should fail gracefully when no trace section exists", () => {
    const result = parseCastTrace("0x0000000000000000000000000000000000000001");

    expect(result.success).toBe(false);
    expect(result.error).toContain("No trace section");
  });

  it("should fail when the trace section contains no parsable frames", () => {
    const result = parseCastTrace("Traces:\n  garbage line\n");

    expect(result.success).toBe(false);
    expect(result.error).toContain("no call frames");
  });
});
