import { z } from "zod";

// ---------------------------------------------------------------------------
// forge test output parser
//
// Example input:
//   Ran 2 tests for test/Counter.t.sol:CounterTest
//   [PASS] testFuzz_SetNumber(uint256) (runs: 256, μ: 27734, ~: 29289)
//   [PASS] test_Increment() (gas: 28784)
//   Suite result: ok. 2 passed; 0 failed; 0 skipped; finished in 9.18ms
//
//   Ran 3 tests for test/Extra.t.sol:ExtraTest
//   [FAIL: panic: ... (0x11); counterexample: calldata=0x... args=[...]] testFuzz_addOverflow(uint256) (runs: 46, μ: 703, ~: 680)
//   [FAIL: one is not two: 1 != 2] test_alwaysFails() (gas: 3829)
//   Suite result: FAILED. 0 passed; 3 failed; 0 skipped; finished in 9.19ms
// ---------------------------------------------------------------------------

export const TestResultSchema = z.object({
  name: z.string(),
  status: z.enum(["pass", "fail", "skip"]),
  reason: z.string().optional(),
  counterexample: z.string().optional(),
  gas: z.number().optional(),
  fuzzRuns: z.number().optional(),
  medianGas: z.number().optional(),
});

export const TestSuiteSchema = z.object({
  name: z.string(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  tests: z.array(TestResultSchema),
});

export type TestResult = z.infer<typeof TestResultSchema>;
export type TestSuite = z.infer<typeof TestSuiteSchema>;

export interface ParsedTestRunResult {
  success: boolean;
  error?: string;
  allPassed?: boolean;
  totalPassed?: number;
  totalFailed?: number;
  totalSkipped?: number;
  suites?: TestSuite[];
}

const SUITE_HEADER = /^Ran \d+ tests? for (.+)$/;
const SUITE_RESULT =
  /^Suite result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) skipped;/;
const TEST_LINE = /^\[(PASS|FAIL|SKIP)(?::\s*(.*?))?\]\s+(\S+)\s+\((.*)\)$/;
const COUNTEREXAMPLE = /;\s*counterexample:\s*(.+)$/;

function parseTestLine(line: string): TestResult | null {
  const match = line.match(TEST_LINE);
  if (!match) return null;

  const [, statusWord, rawReason, name, metrics] = match;
  const result: TestResult = {
    name,
    status: statusWord.toLowerCase() as "pass" | "fail" | "skip",
  };

  if (rawReason) {
    const ceMatch = rawReason.match(COUNTEREXAMPLE);
    if (ceMatch) {
      result.counterexample = ceMatch[1].trim();
      result.reason = rawReason.slice(0, ceMatch.index).trim();
    } else {
      result.reason = rawReason.trim();
    }
  }

  const gasMatch = metrics.match(/^gas:\s*(\d+)$/);
  if (gasMatch) {
    result.gas = parseInt(gasMatch[1], 10);
  }
  const fuzzMatch = metrics.match(/runs:\s*(\d+)/);
  if (fuzzMatch) {
    result.fuzzRuns = parseInt(fuzzMatch[1], 10);
  }
  const medianMatch = metrics.match(/~:\s*(\d+)/);
  if (medianMatch) {
    result.medianGas = parseInt(medianMatch[1], 10);
  }

  return result;
}

export function parseForgeTestOutput(rawOutput: string): ParsedTestRunResult {
  if (
    rawOutput.includes("Compiler run failed") ||
    rawOutput.includes("Compilation failed")
  ) {
    return {
      success: false,
      error: `Tests did not run: compilation failed. Use evm_compile_and_diagnose for structured compiler errors. Raw output: ${rawOutput.slice(0, 800)}`,
    };
  }

  const suites: TestSuite[] = [];
  let current: TestSuite | null = null;

  // Only parse inside "Ran N tests for ..." → "Suite result:" blocks; the
  // trailing "Failing tests:" section repeats failures and must not double-count.
  for (const rawLine of rawOutput.split("\n")) {
    const line = rawLine.trim();

    const header = line.match(SUITE_HEADER);
    if (header) {
      current = { name: header[1], passed: 0, failed: 0, skipped: 0, tests: [] };
      continue;
    }
    if (!current) continue;

    const summary = line.match(SUITE_RESULT);
    if (summary) {
      current.passed = parseInt(summary[1], 10);
      current.failed = parseInt(summary[2], 10);
      current.skipped = parseInt(summary[3], 10);
      suites.push(current);
      current = null;
      continue;
    }

    const test = parseTestLine(line);
    if (test) {
      current.tests.push(test);
    }
  }

  if (suites.length === 0) {
    return {
      success: false,
      error: `No test suites found in forge output. Raw output: ${rawOutput.slice(0, 500)}`,
    };
  }

  const totalPassed = suites.reduce((n, s) => n + s.passed, 0);
  const totalFailed = suites.reduce((n, s) => n + s.failed, 0);
  const totalSkipped = suites.reduce((n, s) => n + s.skipped, 0);

  return {
    success: true,
    allPassed: totalFailed === 0,
    totalPassed,
    totalFailed,
    totalSkipped,
    suites,
  };
}
