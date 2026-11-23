import {
  diffPlans,
  isWasmReady,
  type Plan,
  type PlanConversion,
  type PlanNode,
  type PlanWarning,
} from "./wasm.js";

export interface RegressionOptions {
  /**
   * Maximum allowed `candidateCost / baselineCost` ratio when both plans report comparable
   * optimizer costs. Defaults to `1.25` (25% cost increase tolerance).
   */
  maxCostRatio?: number;
  /**
   * Allow selective index access (`seek`) to flip into a scan (`Seq Scan`, `Table Scan`,
   * `Clustered Index Scan`, `Index Scan`, SQLite `SCAN`) without failing. Defaults to `false`.
   */
  allowScanFlip?: boolean;
}

export interface AssertionEvaluation {
  pass: boolean;
  positiveMessage: string;
  negatedMessage: string;
}

/** Error thrown when a standalone `assertPlan(plan)` assertion fails. */
export class PlanAssertionError extends Error {
  readonly plan: Plan;

  constructor(message: string, plan: Plan) {
    super(message);
    this.name = "PlanAssertionError";
    this.plan = plan;
  }
}

export function assertIsPlan(value: unknown): asserts value is Plan {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as Partial<Plan>).engine !== "string" ||
    typeof (value as Partial<Plan>).total_cost !== "number" ||
    typeof (value as Partial<Plan>).root !== "object" ||
    (value as Partial<Plan>).root === null
  ) {
    throw new TypeError(
      "Expected a parsed `@culpritsql/plans` Plan object (from `explain()` or `explainText()`).",
    );
  }
}

/** Collects every `PlanNode` in pre-order traversal starting at `plan.root`. */
export function collectPlanNodes(plan: Plan): PlanNode[] {
  const nodes: PlanNode[] = [];
  const stack: PlanNode[] = [plan.root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes.push(current);
    for (let i = current.children.length - 1; i >= 0; i -= 1) {
      stack.push(current.children[i]!);
    }
  }
  return nodes;
}

function stripIdentifierQuotes(raw: string): string {
  return raw
    .split(".")
    .map((part) => part.trim().replace(/^\[|\]$|^"|"$|^`|`$/g, ""))
    .filter((part) => part.length > 0)
    .join(".");
}

function leafIdentifier(clean: string): string {
  const idx = clean.lastIndexOf(".");
  return idx === -1 ? clean : clean.slice(idx + 1);
}

function matchesTarget(
  actual: string | null | undefined,
  target?: string | RegExp,
  alias?: string | null,
): boolean {
  if (target === undefined) {
    return Boolean(actual && actual.trim().length > 0);
  }

  const candidates: string[] = [];
  if (actual && actual.trim().length > 0) {
    const clean = stripIdentifierQuotes(actual);
    candidates.push(actual, clean, leafIdentifier(clean));
  }
  if (alias && alias.trim().length > 0) {
    const cleanAlias = stripIdentifierQuotes(alias);
    candidates.push(alias, cleanAlias, leafIdentifier(cleanAlias));
  }

  if (candidates.length === 0) {
    return false;
  }

  if (target instanceof RegExp) {
    return candidates.some((c) => target.test(c));
  }

  const cleanTarget = stripIdentifierQuotes(target);
  const lowerTarget = cleanTarget.toLowerCase();
  if (cleanTarget.includes(".")) {
    return candidates.some((c) => stripIdentifierQuotes(c).toLowerCase() === lowerTarget);
  }
  return candidates.some((c) => leafIdentifier(stripIdentifierQuotes(c)).toLowerCase() === lowerTarget);
}

function formatTargetLabel(target?: string | RegExp): string {
  if (target === undefined) return "any";
  if (target instanceof RegExp) return String(target);
  return `"${target}"`;
}

function formatRowsSummary(node: PlanNode): string {
  const parts: string[] = [];
  if (node.act_rows !== null) {
    parts.push(`act_rows=${Math.round(node.act_rows)}`);
  }
  parts.push(`est_rows=${Math.round(node.est_rows)}`);
  if (node.rows_read !== null) {
    parts.push(`rows_read=${Math.round(node.rows_read)}`);
  }
  return parts.join(", ");
}

/** Formats a single `PlanNode` with id, operator, object, index, row counts, and cost. */
export function formatNodeDiagnostic(node: PlanNode): string {
  const location = node.object ? ` on ${node.object}` : "";
  const indexPart = node.index ? ` [index=${node.index}]` : "";
  const stats: string[] = [formatRowsSummary(node)];
  if (node.subtree_cost > 0) {
    stats.push(`cost=${node.subtree_cost.toFixed(2)}`);
  }
  if (node.act_time_ms !== null) {
    stats.push(`time=${node.act_time_ms.toFixed(2)}ms`);
  }
  if (node.runtime?.logical_reads !== null && node.runtime?.logical_reads !== undefined) {
    stats.push(`logical_reads=${node.runtime.logical_reads}`);
  }
  if (node.runtime?.spill_pages !== null && node.runtime?.spill_pages !== undefined) {
    stats.push(`spill_pages=${node.runtime.spill_pages}`);
  }
  if (node.predicate) {
    stats.push(`filter=${node.predicate}`);
  }
  return `[node #${node.id}] ${node.op}${location}${indexPart} (${stats.join(", ")})`;
}

function formatIndexHintsDiagnostic(plan: Plan, focusNodes?: readonly PlanNode[]): string {
  const lines: string[] = [];

  for (const hint of plan.index_hints) {
    const keys = [...hint.equality, ...hint.inequality];
    const include = hint.include.length > 0 ? ` include=(${hint.include.join(", ")})` : "";
    lines.push(
      `  Index hint on ${hint.table}: key=(${keys.join(", ")})${include} (impact ${hint.impact_pct.toFixed(1)}%)`,
    );
  }

  const nodesToInspect = focusNodes ?? collectPlanNodes(plan);
  for (const node of nodesToInspect) {
    if (node.facts.possible_index_names.length > 0) {
      lines.push(
        `  Possible indexes on ${node.object ?? `node #${node.id}`}: ${node.facts.possible_index_names.join(", ")}`,
      );
    }
    if (node.facts.automatic_index) {
      lines.push(
        `  Automatic temp index built on ${node.facts.automatic_index.table}(${node.facts.automatic_index.columns.join(", ")})`,
      );
    }
  }

  return lines.length > 0 ? `\nIndex diagnostics:\n${lines.join("\n")}` : "";
}

/**
 * Returns true if `node` uses an index (`Index Scan`, `Index Seek`, `Index Only Scan`,
 * `Bitmap Index Scan`, MySQL index lookups, or SQLite `SEARCH/SCAN ... USING [COVERING] INDEX`).
 */
export function isIndexAccessNode(node: PlanNode): boolean {
  const op = node.op.toLowerCase();

  // Exclude full clustered table scans; they scan the base B-tree table rather than seeking/filtering via a secondary index.
  if (op === "clustered index scan") {
    return false;
  }

  // Exclude SQLite throwaway automatic indexes built at runtime when a schema index is missing.
  if (node.facts.automatic_index) {
    return false;
  }

  if (
    op === "index scan" ||
    op === "index seek" ||
    op === "clustered index seek" ||
    op === "index only scan" ||
    op === "bitmap index scan"
  ) {
    return true;
  }

  // SQLite SEARCH ... USING [COVERING] INDEX / INTEGER PRIMARY KEY or SCAN ... USING COVERING INDEX
  const detailUpper = node.detail?.toUpperCase() ?? "";
  if (
    /\bUSING\s+(?:COVERING\s+)?INDEX\b/.test(detailUpper) ||
    /\bUSING\s+(?:INTEGER\s+)?PRIMARY\s+KEY\b/.test(detailUpper)
  ) {
    return true;
  }

  // MySQL / Yugabyte / general seek nodes carrying an explicit index name
  if (node.kind === "seek" && node.index !== null && node.index.trim().length > 0) {
    return true;
  }

  return false;
}

/**
 * Returns true if `node` performs a full table or clustered index scan (`Seq Scan`, `Table Scan`,
 * `Clustered Index Scan`, MySQL `ALL`, or SQLite `SCAN` without an index).
 */
export function isFullTableScanNode(node: PlanNode): boolean {
  const op = node.op.toLowerCase();
  if (
    op === "seq scan" ||
    op === "table scan" ||
    op === "clustered index scan" ||
    op === "columnstore index scan" ||
    op === "clustered columnstore index scan"
  ) {
    return true;
  }

  if (node.props.access_type?.toUpperCase() === "ALL") {
    return true;
  }

  // SQLite `SCAN orders` / `SCAN TABLE orders` without `USING [COVERING] INDEX`
  if (op === "scan" && (node.index === null || node.index.trim().length === 0)) {
    return true;
  }

  return false;
}

function describeNodeSpill(node: PlanNode): string[] {
  const reasons: string[] = [];
  const spillPages = node.runtime?.spill_pages ?? null;
  if (spillPages !== null && spillPages > 0) {
    reasons.push(`spill_pages=${spillPages}`);
  }
  const extraFacts = node.facts as Record<string, unknown>;
  if (extraFacts.spilled === true) {
    reasons.push("facts.spilled=true");
  }
  if (node.facts.sort_on_disk === true) {
    reasons.push("sort_on_disk=true");
  }
  if (node.facts.exchange_spill === true) {
    reasons.push("exchange_spill=true");
  }
  if ((node.facts.hash_batches ?? 0) > 1) {
    reasons.push(`hash_batches=${node.facts.hash_batches}`);
  }
  if ((node.facts.hash_aggregate_batches ?? 0) > 1) {
    reasons.push(`hash_aggregate_batches=${node.facts.hash_aggregate_batches}`);
  }
  if (
    node.props["Sort Space Type"]?.toLowerCase() === "disk" &&
    !reasons.includes("sort_on_disk=true")
  ) {
    reasons.push('Sort Space Type="Disk"');
  }
  if (node.props["Sort Method"]?.toLowerCase().includes("external")) {
    reasons.push(`Sort Method="${node.props["Sort Method"]}"`);
  }
  if (node.warnings.includes("spill")) {
    reasons.push('warning="spill"');
  }
  return reasons;
}

export function evaluateToUseIndex(
  plan: Plan,
  indexName?: string | RegExp,
): AssertionEvaluation {
  const nodes = collectPlanNodes(plan);
  const indexNodes = nodes.filter((node) => {
    if (!isIndexAccessNode(node)) return false;
    if (indexName === undefined) return true;
    return matchesTarget(node.index, indexName);
  });

  const pass = indexNodes.length > 0;
  const label = indexName === undefined ? "an index" : `index ${formatTargetLabel(indexName)}`;
  const allFormatted = nodes.map((n) => `  ${formatNodeDiagnostic(n)}`).join("\n");
  const matchedFormatted = indexNodes.map((n) => `  ${formatNodeDiagnostic(n)}`).join("\n");
  const hints = formatIndexHintsDiagnostic(plan);

  return {
    pass,
    positiveMessage:
      `Expected execution plan (${plan.engine}) to use ${label}, but no matching index operator was found.\n` +
      `Plan operators:\n${allFormatted}${hints}`,
    negatedMessage:
      `Expected execution plan (${plan.engine}) not to use ${label}, but found ${indexNodes.length} matching operator(s):\n` +
      `${matchedFormatted}`,
  };
}

export function evaluateToScanTable(
  plan: Plan,
  tableName?: string | RegExp,
): AssertionEvaluation {
  const nodes = collectPlanNodes(plan);
  const scanNodes = nodes.filter((node) => {
    if (!isFullTableScanNode(node)) return false;
    if (tableName === undefined) return true;
    return matchesTarget(node.object, tableName, node.facts.table_alias);
  });

  const pass = scanNodes.length > 0;
  const label = tableName === undefined ? "any table" : `table ${formatTargetLabel(tableName)}`;
  const allFormatted = nodes.map((n) => `  ${formatNodeDiagnostic(n)}`).join("\n");
  const scanFormatted = scanNodes.map((n) => `  ${formatNodeDiagnostic(n)}`).join("\n");
  const hints = formatIndexHintsDiagnostic(plan, scanNodes.length > 0 ? scanNodes : undefined);

  return {
    pass,
    positiveMessage:
      `Expected execution plan (${plan.engine}) to scan ${label}, but no matching full scan operator was found.\n` +
      `Plan operators:\n${allFormatted}`,
    negatedMessage:
      `Expected execution plan (${plan.engine}) not to scan ${label}, but found ${scanNodes.length} full scan operator(s):\n` +
      `${scanFormatted}${hints}`,
  };
}

export function evaluateToHaveZeroSpills(plan: Plan): AssertionEvaluation {
  const nodes = collectPlanNodes(plan);
  const findings: string[] = [];

  const planExtraFacts = plan.facts as Record<string, unknown>;
  if (plan.warnings.includes("spill")) {
    findings.push('  [plan] plan.warnings includes "spill"');
  }
  if (planExtraFacts.spilled === true) {
    findings.push("  [plan] plan.facts.spilled=true");
  }

  for (const node of nodes) {
    const reasons = describeNodeSpill(node);
    if (reasons.length > 0) {
      findings.push(`  ${formatNodeDiagnostic(node)} -> ${reasons.join(", ")}`);
    }
  }

  const pass = findings.length === 0;
  return {
    pass,
    positiveMessage:
      `Expected execution plan (${plan.engine}) to have zero memory spills to disk/tempdb, but found ${findings.length} spill indicator(s):\n` +
      `${findings.join("\n")}`,
    negatedMessage:
      `Expected execution plan (${plan.engine}) to spill to disk/tempdb, but zero spills were recorded across ${nodes.length} operator(s).`,
  };
}

export function evaluateToCostLessThan(
  plan: Plan,
  maxTotalCost: number,
): AssertionEvaluation {
  if (typeof maxTotalCost !== "number" || !Number.isFinite(maxTotalCost) || maxTotalCost < 0) {
    throw new TypeError(`maxTotalCost must be a finite non-negative number (received ${String(maxTotalCost)}).`);
  }
  if (plan.facts.estimated_cost_unavailable === true) {
    throw new Error(
      `Cannot assert toCostLessThan(${maxTotalCost}): engine "${plan.engine}" does not report optimizer costs on this plan.`,
    );
  }

  const pass = plan.total_cost < maxTotalCost;
  const topNodes = [...collectPlanNodes(plan)]
    .sort((a, b) => b.self_cost - a.self_cost)
    .slice(0, 3)
    .map((n) => `  ${formatNodeDiagnostic(n)} [self_cost=${n.self_cost.toFixed(2)}]`)
    .join("\n");

  return {
    pass,
    positiveMessage:
      `Expected plan total_cost to be less than ${maxTotalCost}, but got ${plan.total_cost.toFixed(4)} (${plan.engine}).\n` +
      `Costliest operators:\n${topNodes}${formatIndexHintsDiagnostic(plan)}`,
    negatedMessage:
      `Expected plan total_cost not to be less than ${maxTotalCost}, but got ${plan.total_cost.toFixed(4)} (${plan.engine}).`,
  };
}

export function evaluateToCompleteWithin(
  plan: Plan,
  maxElapsedMs: number,
): AssertionEvaluation {
  if (typeof maxElapsedMs !== "number" || !Number.isFinite(maxElapsedMs) || maxElapsedMs < 0) {
    throw new TypeError(`maxElapsedMs must be a finite non-negative number (received ${String(maxElapsedMs)}).`);
  }

  const elapsed =
    plan.facts.elapsed_ms !== null && plan.facts.elapsed_ms !== undefined
      ? plan.facts.elapsed_ms
      : plan.kind === "actual" && plan.root.act_time_ms !== null
        ? plan.root.act_time_ms
        : null;

  if (elapsed === null) {
    throw new Error(
      `Cannot assert toCompleteWithin(${maxElapsedMs}ms): plan (${plan.engine}, kind="${plan.kind}") has no measured elapsed_ms. Run explain() with { analyze: true } or supply an actual execution plan.`,
    );
  }

  const pass = elapsed <= maxElapsedMs;
  const slowestNodes = [...collectPlanNodes(plan)]
    .filter((n) => n.act_time_ms !== null)
    .sort((a, b) => (b.act_time_ms ?? 0) - (a.act_time_ms ?? 0))
    .slice(0, 3)
    .map((n) => `  ${formatNodeDiagnostic(n)}`)
    .join("\n");

  return {
    pass,
    positiveMessage:
      `Expected query execution to complete within ${maxElapsedMs}ms, but elapsed_ms was ${elapsed.toFixed(3)}ms (${plan.engine}).` +
      (slowestNodes ? `\nSlowest operators:\n${slowestNodes}` : ""),
    negatedMessage:
      `Expected query execution not to complete within ${maxElapsedMs}ms, but elapsed_ms was ${elapsed.toFixed(3)}ms (${plan.engine}).`,
  };
}

export function evaluateToReadAtMostPages(
  plan: Plan,
  maxLogicalReads: number,
): AssertionEvaluation {
  if (
    typeof maxLogicalReads !== "number" ||
    !Number.isFinite(maxLogicalReads) ||
    maxLogicalReads < 0
  ) {
    throw new TypeError(
      `maxLogicalReads must be a finite non-negative number (received ${String(maxLogicalReads)}).`,
    );
  }

  const nodes = collectPlanNodes(plan);
  const nodesWithReads = nodes.filter(
    (n) => n.runtime?.logical_reads !== null && n.runtime?.logical_reads !== undefined,
  );

  if (nodesWithReads.length === 0 && plan.kind !== "actual") {
    throw new Error(
      `Cannot assert toReadAtMostPages(${maxLogicalReads}): plan (${plan.engine}, kind="${plan.kind}") has no logical_reads buffer/page counters. Run explain() with { analyze: true, buffers: true } or supply an actual plan with I/O counters.`,
    );
  }

  const totalLogicalReads = nodesWithReads.reduce(
    (sum, n) => sum + (n.runtime?.logical_reads ?? 0),
    0,
  );
  const pass = totalLogicalReads <= maxLogicalReads;

  const topReaders = [...nodesWithReads]
    .sort((a, b) => (b.runtime?.logical_reads ?? 0) - (a.runtime?.logical_reads ?? 0))
    .slice(0, 3)
    .map((n) => `  ${formatNodeDiagnostic(n)}`)
    .join("\n");

  return {
    pass,
    positiveMessage:
      `Expected plan to read at most ${maxLogicalReads} logical pages/buffers, but read ${totalLogicalReads} (${plan.engine}).` +
      (topReaders ? `\nTop I/O operators:\n${topReaders}` : "") +
      formatIndexHintsDiagnostic(plan),
    negatedMessage:
      `Expected plan to read more than ${maxLogicalReads} logical pages/buffers, but read ${totalLogicalReads} (${plan.engine}).`,
  };
}

export function evaluateToHaveZeroWarnings(plan: Plan): AssertionEvaluation {
  const nodes = collectPlanNodes(plan);
  const issues: string[] = [];

  for (const warning of plan.warnings) {
    issues.push(`  [plan] warning="${warning}"`);
  }
  for (const conv of plan.facts.conversions) {
    issues.push(`  [plan] implicit-conversion (${conv.issue}): ${conv.expression}`);
  }
  if (plan.facts.memory_grant_warning) {
    issues.push(`  [plan] memory_grant_warning: ${plan.facts.memory_grant_warning}`);
  }

  for (const node of nodes) {
    const nodeProblems: string[] = [];
    for (const w of node.warnings as PlanWarning[]) {
      nodeProblems.push(`warning="${w}"`);
    }
    for (const conv of node.facts.conversions as PlanConversion[]) {
      nodeProblems.push(`implicit-conversion (${conv.issue}): ${conv.expression}`);
    }
    if (nodeProblems.length > 0) {
      issues.push(`  ${formatNodeDiagnostic(node)} -> ${nodeProblems.join("; ")}`);
    }
  }

  const pass = issues.length === 0;
  return {
    pass,
    positiveMessage:
      `Expected execution plan (${plan.engine}) to have zero warnings or implicit conversions, but found ${issues.length}:\n` +
      `${issues.join("\n")}${formatIndexHintsDiagnostic(plan)}`,
    negatedMessage:
      `Expected execution plan (${plan.engine}) to have at least one warning or implicit conversion, but none were present.`,
  };
}

export function evaluateToNotRegressFrom(
  candidatePlan: Plan,
  baselinePlan: Plan,
  opts?: RegressionOptions,
): AssertionEvaluation {
  assertIsPlan(baselinePlan);
  if (!isWasmReady()) {
    throw new Error(
      "@culpritsql/plans WebAssembly module is not initialized yet. Call `await initWasm()` or parse plans via `explain()` / `explainText()` before calling `toNotRegressFrom()`.",
    );
  }

  const maxCostRatio = opts?.maxCostRatio ?? 1.25;
  const allowScanFlip = opts?.allowScanFlip ?? false;

  if (typeof maxCostRatio !== "number" || !Number.isFinite(maxCostRatio) || maxCostRatio <= 0) {
    throw new TypeError(`maxCostRatio must be a finite positive number (received ${String(maxCostRatio)}).`);
  }

  const diff = diffPlans(baselinePlan, "baseline", candidatePlan, "candidate");
  const regressions: string[] = [];

  const nodesA = new Map<number, PlanNode>(collectPlanNodes(baselinePlan).map((n) => [n.id, n]));
  const nodesB = new Map<number, PlanNode>(collectPlanNodes(candidatePlan).map((n) => [n.id, n]));

  // 1. Check cost spike
  if (diff.comparable && diff.cost_ratio !== null && Number.isFinite(diff.cost_ratio)) {
    if (diff.cost_ratio > maxCostRatio) {
      regressions.push(
        `  Cost spike: ${diff.cost_ratio.toFixed(2)}x baseline (baseline=${(diff.cost_a ?? baselinePlan.total_cost).toFixed(4)}, candidate=${(diff.cost_b ?? candidatePlan.total_cost).toFixed(4)}, maxCostRatio=${maxCostRatio})`,
      );
    }
  }

  // 2. Check access-path regressions (seek/index -> scan flips)
  if (!allowScanFlip) {
    const flaggedCandidateNodeIds = new Set<number>();

    for (const change of diff.changes) {
      if (change.kind !== "access") continue;
      const nodeA = change.a !== null ? nodesA.get(change.a) : undefined;
      const nodeB = change.b !== null ? nodesB.get(change.b) : undefined;
      if (!nodeB) continue;

      const degradedSeekToScan = nodeA?.kind === "seek" && nodeB.kind === "scan";
      const introducedFullScan =
        isFullTableScanNode(nodeB) && (!nodeA || !isFullTableScanNode(nodeA));

      if (degradedSeekToScan || introducedFullScan) {
        flaggedCandidateNodeIds.add(nodeB.id);
        regressions.push(
          `  Access-path regression: ${change.title}${change.detail ? ` (${change.detail})` : ""}\n` +
            `    baseline:  ${nodeA ? formatNodeDiagnostic(nodeA) : "none"}\n` +
            `    candidate: ${formatNodeDiagnostic(nodeB)}`,
        );
      }
    }

    // Also catch join restructurings where a table previously only accessed via seek/index is now full-scanned
    const baselineIndexedTables = new Set<string>();
    const baselineScannedTables = new Set<string>();
    for (const nodeA of nodesA.values()) {
      const tableKey = nodeA.object ? leafIdentifier(stripIdentifierQuotes(nodeA.object)).toLowerCase() : "";
      if (!tableKey) continue;
      if (isFullTableScanNode(nodeA)) {
        baselineScannedTables.add(tableKey);
      } else if (isIndexAccessNode(nodeA)) {
        baselineIndexedTables.add(tableKey);
      }
    }

    for (const nodeB of nodesB.values()) {
      if (flaggedCandidateNodeIds.has(nodeB.id) || !isFullTableScanNode(nodeB) || !nodeB.object) {
        continue;
      }
      const tableKey = leafIdentifier(stripIdentifierQuotes(nodeB.object)).toLowerCase();
      if (baselineIndexedTables.has(tableKey) && !baselineScannedTables.has(tableKey)) {
        flaggedCandidateNodeIds.add(nodeB.id);
        regressions.push(
          `  Access-path scan flip on "${nodeB.object}": baseline used an index without full scans, candidate performs full scan:\n` +
            `    candidate: ${formatNodeDiagnostic(nodeB)}`,
        );
      }
    }
  }

  const pass = regressions.length === 0;
  const headlineSummary =
    diff.headlines.length > 0
      ? `\nDiff headlines:\n${diff.headlines.map((h) => `  - ${h}`).join("\n")}`
      : "";

  return {
    pass,
    positiveMessage:
      `Expected candidate execution plan (${candidatePlan.engine}) not to regress from baseline, but detected ${regressions.length} regression(s):\n` +
      `${regressions.join("\n")}${headlineSummary}${formatIndexHintsDiagnostic(candidatePlan)}`,
    negatedMessage:
      `Expected candidate execution plan (${candidatePlan.engine}) to regress from baseline (maxCostRatio=${maxCostRatio}, allowScanFlip=${String(allowScanFlip)}), but no regressions were detected` +
      (diff.cost_ratio !== null ? ` (cost_ratio=${diff.cost_ratio.toFixed(2)}x).` : "."),
  };
}

/**
 * Fluent framework-agnostic assertion wrapper for a parsed `Plan`.
 * Supports chaining and single-step `.not` negation (`assertPlan(plan).not.toScanTable("orders").toUseIndex("idx")`).
 */
export class PlanAssertions {
  readonly #plan: Plan;
  readonly #negated: boolean;
  readonly #positiveSelf: PlanAssertions;

  constructor(plan: Plan, negated = false, positiveSelf?: PlanAssertions) {
    assertIsPlan(plan);
    this.#plan = plan;
    this.#negated = negated;
    this.#positiveSelf = positiveSelf ?? this;
  }

  /** Negates the next assertion in the chain. */
  get not(): PlanAssertions {
    return new PlanAssertions(this.#plan, !this.#negated, this.#positiveSelf);
  }

  #check(result: AssertionEvaluation): PlanAssertions {
    if (this.#negated) {
      if (result.pass) {
        throw new PlanAssertionError(result.negatedMessage, this.#plan);
      }
    } else if (!result.pass) {
      throw new PlanAssertionError(result.positiveMessage, this.#plan);
    }
    return this.#positiveSelf;
  }

  toUseIndex(indexName?: string | RegExp): PlanAssertions {
    return this.#check(evaluateToUseIndex(this.#plan, indexName));
  }

  toScanTable(tableName?: string | RegExp): PlanAssertions {
    return this.#check(evaluateToScanTable(this.#plan, tableName));
  }

  toHaveZeroSpills(): PlanAssertions {
    return this.#check(evaluateToHaveZeroSpills(this.#plan));
  }

  toCostLessThan(maxTotalCost: number): PlanAssertions {
    return this.#check(evaluateToCostLessThan(this.#plan, maxTotalCost));
  }

  toCompleteWithin(maxElapsedMs: number): PlanAssertions {
    return this.#check(evaluateToCompleteWithin(this.#plan, maxElapsedMs));
  }

  toReadAtMostPages(maxLogicalReads: number): PlanAssertions {
    return this.#check(evaluateToReadAtMostPages(this.#plan, maxLogicalReads));
  }

  toHaveZeroWarnings(): PlanAssertions {
    return this.#check(evaluateToHaveZeroWarnings(this.#plan));
  }

  toNotRegressFrom(baselinePlan: Plan, opts?: RegressionOptions): PlanAssertions {
    return this.#check(evaluateToNotRegressFrom(this.#plan, baselinePlan, opts));
  }
}

/** Creates a fluent, framework-agnostic assertion chain for a `@culpritsql/plans` `Plan`. */
export function assertPlan(plan: Plan): PlanAssertions {
  return new PlanAssertions(plan);
}
