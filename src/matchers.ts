import {
  assertIsPlan,
  evaluateToCompleteWithin,
  evaluateToCostLessThan,
  evaluateToHaveZeroSpills,
  evaluateToHaveZeroWarnings,
  evaluateToNotRegressFrom,
  evaluateToReadAtMostPages,
  evaluateToScanTable,
  evaluateToUseIndex,
  type AssertionEvaluation,
  type RegressionOptions,
} from "./assertions.js";
import type { Plan } from "./wasm.js";

export interface MatcherResult {
  pass: boolean;
  message: () => string;
}

function toMatcherResult(evaluation: AssertionEvaluation): MatcherResult {
  return {
    pass: evaluation.pass,
    message: () => (evaluation.pass ? evaluation.negatedMessage : evaluation.positiveMessage),
  };
}

/**
 * Custom Vitest, Jest, and `bun:test` matchers for `@culpritsql/plans` `Plan` objects.
 * Register once with `expect.extend(culpritMatchers)`.
 */
export interface CustomMatchers<R = unknown> {
  /** Asserts that at least one operator uses an index (optionally matching `indexName`). */
  toUseIndex(indexName?: string | RegExp): R;
  /** Asserts that at least one operator performs a full table or clustered index scan (use `.not.toScanTable(...)` to catch missing indexes). */
  toScanTable(tableName?: string | RegExp): R;
  /** Asserts that zero operators spilled sort or hash work to disk / tempdb. */
  toHaveZeroSpills(): R;
  /** Asserts that `plan.total_cost` is strictly less than `maxTotalCost`. */
  toCostLessThan(maxTotalCost: number): R;
  /** Asserts that measured execution time (`plan.facts.elapsed_ms`) is at most `maxElapsedMs`. */
  toCompleteWithin(maxElapsedMs: number): R;
  /** Asserts that total logical buffer/page reads across all operators are at most `maxLogicalReads`. */
  toReadAtMostPages(maxLogicalReads: number): R;
  /** Asserts that the plan has zero optimizer warnings and zero implicit type conversions. */
  toHaveZeroWarnings(): R;
  /** Asserts that the candidate plan has no access-path scan flips or cost spikes compared to `baselinePlan`. */
  toNotRegressFrom(baselinePlan: Plan, opts?: RegressionOptions): R;
}

declare global {
  // Vitest global assertion augmentation
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Vi {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interface Assertion<T = any> extends CustomMatchers<T> {}
    interface AsymmetricMatchersContaining extends CustomMatchers {}
  }

  // Jest and bun:test global matcher augmentation
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> extends CustomMatchers<R> {}
  }
}

export const culpritMatchers = {
  toUseIndex(received: unknown, indexName?: string | RegExp): MatcherResult {
    assertIsPlan(received);
    return toMatcherResult(evaluateToUseIndex(received, indexName));
  },

  toScanTable(received: unknown, tableName?: string | RegExp): MatcherResult {
    assertIsPlan(received);
    return toMatcherResult(evaluateToScanTable(received, tableName));
  },

  toHaveZeroSpills(received: unknown): MatcherResult {
    assertIsPlan(received);
    return toMatcherResult(evaluateToHaveZeroSpills(received));
  },

  toCostLessThan(received: unknown, maxTotalCost: number): MatcherResult {
    assertIsPlan(received);
    return toMatcherResult(evaluateToCostLessThan(received, maxTotalCost));
  },

  toCompleteWithin(received: unknown, maxElapsedMs: number): MatcherResult {
    assertIsPlan(received);
    return toMatcherResult(evaluateToCompleteWithin(received, maxElapsedMs));
  },

  toReadAtMostPages(received: unknown, maxLogicalReads: number): MatcherResult {
    assertIsPlan(received);
    return toMatcherResult(evaluateToReadAtMostPages(received, maxLogicalReads));
  },

  toHaveZeroWarnings(received: unknown): MatcherResult {
    assertIsPlan(received);
    return toMatcherResult(evaluateToHaveZeroWarnings(received));
  },

  toNotRegressFrom(
    received: unknown,
    baselinePlan: Plan,
    opts?: RegressionOptions,
  ): MatcherResult {
    assertIsPlan(received);
    return toMatcherResult(evaluateToNotRegressFrom(received, baselinePlan, opts));
  },
};
