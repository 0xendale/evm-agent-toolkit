import { describe, it, expect } from "vitest";
import { parseForgeGasReport } from "../src/tools/forge.js";

describe("Forge Gas Report Parser", () => {
  it("should successfully parse a standard forge gas report table", () => {
    const rawOutput = `
Running 2 tests for test/Contract.t.sol:ContractTest
[PASS] test_doSomething() (gas: 50000)
[PASS] test_doAnotherThing() (gas: 60000)
Test result: ok. 2 passed; 0 failed; 0 skipped; finished in 2.00ms

| src/Contract.sol:Contract contract |                 |       |        |       |         |
|------------------------------------|-----------------|-------|--------|-------|---------|
| Deployment Cost                    | Deployment Size |       |        |       |         |
| 150000                             | 1200            |       |        |       |         |
| Function Name                      | min             | avg   | median | max   | # calls |
| doAnotherThing                     | 2000            | 2100  | 2100   | 2200  | 2       |
| doSomething                        | 1000            | 1200  | 1200   | 1500  | 10      |
    `;

    const result = parseForgeGasReport(rawOutput);

    expect(result.success).toBe(true);
    expect(result.contracts?.length).toBe(1);

    const contract = result.contracts![0];
    expect(contract.name).toBe("src/Contract.sol:Contract");
    expect(contract.deploymentCost).toBe(150000);
    expect(contract.deploymentSize).toBe(1200);

    expect(contract.functions.length).toBe(2);
    expect(contract.functions[0].name).toBe("doAnotherThing");
    expect(contract.functions[0].avg).toBe(2100);

    expect(contract.functions[1].name).toBe("doSomething");
    expect(contract.functions[1].max).toBe(1500);
  });

  it("should handle output with no gas reports gracefully", () => {
    const rawOutput =
      "Test result: ok. 2 passed; 0 failed; 0 skipped; finished in 2.00ms";
    const result = parseForgeGasReport(rawOutput);

    expect(result.success).toBe(true);
    expect(result.contracts?.length).toBe(0);
  });

  it("should handle build errors", () => {
    const rawOutput = "Error: Failed to build project\nCompiler run failed";
    const result = parseForgeGasReport(rawOutput);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to build or run forge tests");
  });
});
