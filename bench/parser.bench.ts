import { parseSlitherOutput } from "../src/tools/slither.js";
import { parseForgeGasReport } from "../src/tools/forge.js";

const mockSlitherOutput = JSON.stringify({
  success: true,
  error: null,
  results: {
    detectors: Array.from({ length: 100 }, (_, i) => ({
      check: `reentrancy-eth-${i}`,
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
    })),
  },
});

const mockForgeOutput = `
Running 2 tests for test/Contract.t.sol:ContractTest
[PASS] test_doSomething() (gas: 50000)
Test result: ok. 2 passed; 0 failed; 0 skipped; finished in 2.00ms

| src/Contract.sol:Contract contract |                 |       |        |       |         |
|------------------------------------|-----------------|-------|--------|-------|---------|
| Deployment Cost                    | Deployment Size |       |        |       |         |
| 150000                             | 1200            |       |        |       |         |
| Function Name                      | min             | avg   | median | max   | # calls |
| doAnotherThing                     | 2000            | 2100  | 2100   | 2200  | 2       |
| doSomething                        | 1000            | 1200  | 1200   | 1500  | 10      |
`;

function benchSlither(iterations: number) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    parseSlitherOutput(mockSlitherOutput);
  }
  const end = performance.now();
  console.log(
    `[Bench] Slither Parser (${iterations} runs, 100 detectors each): ${(end - start).toFixed(2)}ms`,
  );
}

function benchForge(iterations: number) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    parseForgeGasReport(mockForgeOutput);
  }
  const end = performance.now();
  console.log(
    `[Bench] Forge Gas Parser (${iterations} runs): ${(end - start).toFixed(2)}ms`,
  );
}

console.log("Starting Benchmark Suite...");
benchSlither(1000);
benchForge(10000);
console.log("Benchmarks complete.");
