import { describe, it, expect } from "vitest";
import { parseForgeTestOutput } from "../src/tools/testrunner.js";

// Fixture captured from a real `forge test` run (forge 1.6.0-nightly).
const MIXED_RUN = `
Ran 2 tests for test/Counter.t.sol:CounterTest
[PASS] testFuzz_SetNumber(uint256) (runs: 256, μ: 27734, ~: 29289)
[PASS] test_Increment() (gas: 28784)
Suite result: ok. 2 passed; 0 failed; 0 skipped; finished in 9.18ms (7.19ms CPU time)

Ran 3 tests for test/Extra.t.sol:ExtraTest
[FAIL: failed to set up invariant testing environment: No contracts to fuzz.] invariant_totalZero() (runs: 0, calls: 0, reverts: 0)
[FAIL: panic: arithmetic underflow or overflow (0x11); counterexample: calldata=0xcc18751bffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff args=[115792089237316195423570985008687907853269984665640564039457584007913129639935 [1.157e77]]] testFuzz_addOverflow(uint256) (runs: 46, μ: 703, ~: 680)
[FAIL: one is not two: 1 != 2] test_alwaysFails() (gas: 3829)
Suite result: FAILED. 0 passed; 3 failed; 0 skipped; finished in 9.19ms (11.65ms CPU time)

Ran 2 test suites in 14.27ms (18.37ms CPU time): 2 tests passed, 3 failed, 0 skipped (5 total tests)

Failing tests:
Encountered 3 failing tests in test/Extra.t.sol:ExtraTest
[FAIL: one is not two: 1 != 2] test_alwaysFails() (gas: 3829)

Encountered a total of 3 failing tests, 2 tests succeeded
`;

describe("Forge Test Output Parser", () => {
  it("should parse a mixed pass/fail run with two suites", () => {
    const result = parseForgeTestOutput(MIXED_RUN);

    expect(result.success).toBe(true);
    expect(result.allPassed).toBe(false);
    expect(result.totalPassed).toBe(2);
    expect(result.totalFailed).toBe(3);
    expect(result.totalSkipped).toBe(0);
    expect(result.suites?.length).toBe(2);

    const counter = result.suites![0];
    expect(counter.name).toBe("test/Counter.t.sol:CounterTest");
    expect(counter.passed).toBe(2);
    expect(counter.tests.length).toBe(2);
  });

  it("should extract gas for unit tests and runs/median for fuzz tests", () => {
    const result = parseForgeTestOutput(MIXED_RUN);
    const counter = result.suites![0];

    const fuzz = counter.tests.find((t) => t.name.startsWith("testFuzz_SetNumber"));
    expect(fuzz?.status).toBe("pass");
    expect(fuzz?.fuzzRuns).toBe(256);
    expect(fuzz?.medianGas).toBe(29289);
    expect(fuzz?.gas).toBeUndefined();

    const unit = counter.tests.find((t) => t.name.startsWith("test_Increment"));
    expect(unit?.gas).toBe(28784);
  });

  it("should split failure reason and fuzz counterexample", () => {
    const result = parseForgeTestOutput(MIXED_RUN);
    const extra = result.suites![1];

    const fuzzFail = extra.tests.find((t) =>
      t.name.startsWith("testFuzz_addOverflow")
    );
    expect(fuzzFail?.status).toBe("fail");
    expect(fuzzFail?.reason).toBe(
      "panic: arithmetic underflow or overflow (0x11)"
    );
    expect(fuzzFail?.counterexample).toContain("calldata=0xcc18751b");
    expect(fuzzFail?.fuzzRuns).toBe(46);

    const plainFail = extra.tests.find((t) => t.name.startsWith("test_alwaysFails"));
    expect(plainFail?.reason).toBe("one is not two: 1 != 2");
    expect(plainFail?.counterexample).toBeUndefined();

    const invariant = extra.tests.find((t) => t.name.startsWith("invariant_"));
    expect(invariant?.status).toBe("fail");
    expect(invariant?.fuzzRuns).toBe(0);
  });

  it("should not double-count failures repeated in the 'Failing tests:' section", () => {
    const result = parseForgeTestOutput(MIXED_RUN);
    const extra = result.suites![1];

    expect(extra.tests.length).toBe(3);
    expect(
      extra.tests.filter((t) => t.name.startsWith("test_alwaysFails")).length
    ).toBe(1);
  });

  it("should report allPassed for a green run", () => {
    const green = `
Ran 1 test for test/Counter.t.sol:CounterTest
[PASS] test_Increment() (gas: 28784)
Suite result: ok. 1 passed; 0 failed; 0 skipped; finished in 1.00ms
`;
    const result = parseForgeTestOutput(green);

    expect(result.success).toBe(true);
    expect(result.allPassed).toBe(true);
    expect(result.totalFailed).toBe(0);
  });

  it("should fail gracefully when compilation fails", () => {
    const result = parseForgeTestOutput(
      "Compiling 1 files with Solc 0.8.23\nError (2314): Expected ';'\nCompiler run failed"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("compilation failed");
  });

  it("should fail gracefully when no suites are present", () => {
    const result = parseForgeTestOutput("No tests found in project!");

    expect(result.success).toBe(false);
    expect(result.error).toContain("No test suites");
  });
});
