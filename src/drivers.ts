import {
  extractNamedParameters,
  extractRawQuery,
  normalizeQuery,
  type ParameterStyle,
  type QueryInput,
  type QueryParams,
} from "./query.js";
import { ensureWasmInit, parsePlan, type Engine, type Plan } from "./wasm.js";

/** `pg` PoolClient checked out from `pool.connect()`. */
export interface PgPoolClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(err?: unknown): void;
}

/** `pg` Pool or Client shape. */
export interface PgClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  connect?(): Promise<PgPoolClientLike | void>;
  totalCount?: number;
  idleCount?: number;
  processID?: number;
  supportsTransactions?: boolean;
}

/** Reserved connection or transaction handle for `postgres.js` / `Bun.sql`. */
export interface UnsafeTxLike {
  unsafe(query: string, params?: unknown[]): Promise<unknown[]>;
  release?(): void | Promise<void>;
}

/** `postgres.js` or `Bun.sql` client shape. */
export interface PostgresUnsafeClientLike {
  unsafe(query: string, params?: unknown[]): Promise<unknown[]>;
  reserve?(): Promise<UnsafeTxLike>;
  begin?<T>(callback: (tx: UnsafeTxLike) => Promise<T>): Promise<T>;
}

/** `mysql2/promise` Pool or Connection shape. */
export interface Mysql2ClientLike {
  query(sql: string, values?: unknown[]): Promise<unknown>;
  execute?(sql: string, values?: unknown[]): Promise<unknown>;
}

/** Prepared statement shape for `better-sqlite3`, `node:sqlite`, `bun:sqlite`, or Cloudflare D1. */
export interface SqlitePreparedStatementLike {
  all(...params: unknown[]): unknown;
  bind?(...params: unknown[]): SqlitePreparedStatementLike;
}

/** SQLite client shape (`better-sqlite3`, `node:sqlite`, `bun:sqlite`, `sqlite`, LibSQL, Cloudflare D1). */
export type SqliteClientLike =
  | {
      prepare(sql: string): SqlitePreparedStatementLike;
      batch?: unknown;
    }
  | {
      all(sql: string, params?: unknown[]): unknown;
    }
  | {
      execute(stmt: { sql: string; args?: unknown[] } | string): Promise<{ rows: unknown[] }>;
    };

/** Union of all zero-dependency database client shapes supported by `explain()`. */
export type SupportedDriverClient =
  | PgClientLike
  | PostgresUnsafeClientLike
  | Mysql2ClientLike
  | SqliteClientLike
  | ((...args: never[]) => unknown);

export interface ExplainOptions {
  /** Override engine auto-detection (`"postgres" | "yugabyte" | "mysql" | "sqlite" | "mssql"`). */
  engine?: Engine;
  /**
   * Execute the query (`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on PostgreSQL/YugabyteDB,
   * `EXPLAIN ANALYZE` on MySQL 8+). On PostgreSQL/YugabyteDB, wraps execution in a safe
   * `BEGIN READ ONLY ... ROLLBACK` transaction.
   */
  analyze?: boolean;
  /** Request buffer counters on PostgreSQL/YugabyteDB (defaults to `true` when `analyze: true`). */
  buffers?: boolean;
  /**
   * Explicitly allow `analyze: true` on a PostgreSQL driver that lacks session-pinned transaction
   * control (`connect()`, `reserve()`, or `begin()`). Defaults to `false`.
   */
  allowMutatingAnalyze?: boolean;
}

const KNOWN_OPTION_KEYS = new Set([
  "engine",
  "analyze",
  "buffers",
  "allowMutatingAnalyze",
]);

class RollbackSentinel {
  readonly rows: unknown[];
  constructor(rows: unknown[]) {
    this.rows = rows;
  }
}

/**
 * Parses raw plan text (PostgreSQL JSON/text, SQL Server `.sqlplan` XML, MySQL JSON/tree,
 * YugabyteDB JSON, or SQLite `EXPLAIN QUERY PLAN`) via `@culpritsql/plans`, automatically
 * initializing WebAssembly if needed.
 */
export async function explainText(rawPlan: string, engine?: Engine): Promise<Plan> {
  if (typeof rawPlan !== "string" || rawPlan.trim().length === 0) {
    throw new Error("Cannot parse an empty execution plan string.");
  }
  await ensureWasmInit();
  return parsePlan(rawPlan, engine);
}

/**
 * Formats SQLite `EXPLAIN QUERY PLAN` row objects (`{ id, parent, notused, detail }`,
 * legacy `{ selectid, order, from, detail }`, or `[id, parent, notused, detail]` tuples)
 * into canonical `QUERY PLAN` tree text accepted by `@culpritsql/plans`.
 */
export function formatSqliteExplainRows(rows: readonly unknown[]): string {
  if (rows.length === 0) {
    throw new Error("SQLite EXPLAIN QUERY PLAN returned zero rows.");
  }

  interface NormalizedStep {
    id: number;
    parent: number;
    detail: string;
  }

  const steps: NormalizedStep[] = rows.map((row, idx) => {
    if (Array.isArray(row)) {
      const id = Number(row[0] ?? idx + 1);
      const parent = Number(row[1] ?? 0);
      const detail = String(row[3] ?? row[2] ?? "").trim();
      return { id, parent, detail };
    }
    if (row !== null && typeof row === "object") {
      const rec = row as Record<string, unknown>;
      const detailRaw = rec.detail ?? rec.DETAIL ?? "";
      const detail = String(detailRaw).trim();
      if ("id" in rec || "ID" in rec) {
        const id = Number(rec.id ?? rec.ID);
        const parent = Number(rec.parent ?? rec.PARENT ?? 0);
        return { id, parent, detail };
      }
      // Legacy SQLite (< 3.24): selectid | order | from | detail
      return { id: idx + 1, parent: 0, detail };
    }
    return { id: idx + 1, parent: 0, detail: String(row).trim() };
  });

  if (steps.some((s) => s.detail.length === 0)) {
    throw new Error("SQLite EXPLAIN QUERY PLAN row is missing a `detail` description.");
  }

  const knownIds = new Set(steps.map((s) => s.id));
  const childrenByParent = new Map<number, NormalizedStep[]>();
  const roots: NormalizedStep[] = [];

  for (const step of steps) {
    if (!knownIds.has(step.parent) || step.parent === step.id) {
      roots.push(step);
    } else {
      let list = childrenByParent.get(step.parent);
      if (!list) {
        list = [];
        childrenByParent.set(step.parent, list);
      }
      list.push(step);
    }
  }

  const lines: string[] = ["QUERY PLAN"];
  const visited = new Set<number>();

  function walk(items: readonly NormalizedStep[], prefix: string): void {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]!;
      const isLast = i === items.length - 1;
      const branch = isLast ? "`--" : "|--";
      lines.push(`${prefix}${branch}${item.detail}`);
      if (!visited.has(item.id)) {
        visited.add(item.id);
        const kids = childrenByParent.get(item.id);
        if (kids && kids.length > 0) {
          walk(kids, `${prefix}${isLast ? "   " : "|  "}`);
        }
      }
    }
  }

  walk(roots, "");
  return lines.join("\n");
}

function isExplainOptionsCandidate(
  arg: unknown,
  sql: string,
): arg is ExplainOptions {
  if (arg === null || typeof arg !== "object" || Array.isArray(arg)) {
    return false;
  }
  const keys = Object.keys(arg);
  if (keys.length === 0) {
    return true;
  }
  if (!keys.every((k) => KNOWN_OPTION_KEYS.has(k))) {
    return false;
  }
  const referencedParams = extractNamedParameters(sql);
  return !keys.some((k) => referencedParams.has(k));
}

type DriverKind = "pg" | "postgres-unsafe" | "mysql2" | "sqlite";

function detectDriverKind(client: unknown, explicitEngine?: Engine): DriverKind {
  if ((typeof client !== "object" && typeof client !== "function") || client === null) {
    throw new TypeError("Unsupported database client: expected a driver connection, pool, or SQL tag.");
  }

  const candidate = client as Record<string, unknown>;

  if (explicitEngine === "sqlite") {
    return "sqlite";
  }
  if (explicitEngine === "mysql") {
    return "mysql2";
  }
  if (explicitEngine === "postgres" || explicitEngine === "yugabyte") {
    if (typeof candidate.unsafe === "function") {
      return "postgres-unsafe";
    }
    if (typeof candidate.query === "function") {
      return "pg";
    }
    throw new TypeError(
      `Client does not expose PostgreSQL .query() or .unsafe() methods required for engine "${explicitEngine}".`,
    );
  }

  // 1. postgres.js / Bun.sql expose .unsafe(sql, params)
  if (typeof candidate.unsafe === "function") {
    return "postgres-unsafe";
  }

  // 2. SQLite: .prepare(sql).all(...) or .all(sql, ...) or LibSQL .execute(...) without .query(...)
  if (
    typeof candidate.prepare === "function" ||
    typeof candidate.all === "function" ||
    (typeof candidate.execute === "function" && typeof candidate.query !== "function")
  ) {
    return "sqlite";
  }

  // 3. mysql2/promise exposes both .query() and .execute()
  if (typeof candidate.query === "function" && typeof candidate.execute === "function") {
    return "mysql2";
  }

  // 4. node-postgres (pg Pool / Client) exposes .query()
  if (typeof candidate.query === "function") {
    return "pg";
  }

  throw new TypeError(
    "Unable to auto-detect database driver from client shape. Pass `options.engine` or a supported pg, postgres.js, Bun.sql, mysql2, or SQLite client.",
  );
}

function extractPostgresPlanJson(rows: readonly unknown[]): string {
  if (rows.length === 0) {
    throw new Error("PostgreSQL EXPLAIN returned zero rows.");
  }
  const first = rows[0];
  if (typeof first === "string") {
    return first;
  }
  if (Array.isArray(first)) {
    const val = first[0];
    return typeof val === "string" ? val : JSON.stringify(val);
  }
  if (first !== null && typeof first === "object") {
    const rec = first as Record<string, unknown>;
    const planValue =
      rec["QUERY PLAN"] ??
      rec["query plan"] ??
      rec.query_plan ??
      Object.values(rec)[0];
    if (typeof planValue === "string") {
      // Multi-row text fallback if a custom wrapper returned text lines
      if (rows.length > 1) {
        return rows
          .map((r) => String(Object.values(r as Record<string, unknown>)[0] ?? ""))
          .join("\n");
      }
      return planValue;
    }
    if (planValue !== undefined) {
      return JSON.stringify(planValue);
    }
  }
  throw new Error("Unrecognized PostgreSQL EXPLAIN result row format.");
}

async function runPgExplain(
  client: PgClientLike,
  sql: string,
  params: unknown[],
  options: ExplainOptions,
): Promise<Plan> {
  const engine: Engine = options.engine === "yugabyte" ? "yugabyte" : "postgres";
  const analyze = options.analyze === true;
  const buffers = options.buffers ?? analyze;

  const formatOpts: string[] = [];
  if (analyze) formatOpts.push("ANALYZE");
  if (buffers) formatOpts.push("BUFFERS");
  formatOpts.push("FORMAT JSON");
  const explainSql = `EXPLAIN (${formatOpts.join(", ")}) ${sql}`;

  if (!analyze) {
    const res = await client.query(explainSql, params);
    const json = extractPostgresPlanJson(res.rows);
    const plan = await explainText(json, engine);
    if (plan.statement === null) {
      plan.statement = sql;
    }
    return plan;
  }

  // Safe ANALYZE execution inside BEGIN READ ONLY ... ROLLBACK
  if (client.supportsTransactions === false) {
    if (!options.allowMutatingAnalyze) {
      throw new Error(
        "Refusing EXPLAIN ANALYZE: PostgreSQL client reports `supportsTransactions: false` and cannot guarantee a safe BEGIN READ ONLY ... ROLLBACK wrapper. Set `{ allowMutatingAnalyze: true }` to override.",
      );
    }
    const res = await client.query(explainSql, params);
    const json = extractPostgresPlanJson(res.rows);
    const plan = await explainText(json, engine);
    if (plan.statement === null) plan.statement = sql;
    return plan;
  }

  const isClientInstance = typeof client.processID === "number";
  if (!isClientInstance && typeof client.connect === "function") {
    const acquired = await client.connect();
    if (
      acquired !== null &&
      typeof acquired === "object" &&
      "query" in acquired &&
      typeof acquired.query === "function"
    ) {
      try {
        await acquired.query("BEGIN READ ONLY");
        let res: { rows: Record<string, unknown>[] };
        try {
          res = await acquired.query(explainSql, params);
        } finally {
          await acquired.query("ROLLBACK");
        }
        const json = extractPostgresPlanJson(res.rows);
        const plan = await explainText(json, engine);
        if (plan.statement === null) plan.statement = sql;
        return plan;
      } finally {
        acquired.release();
      }
    }
  }

  const looksLikePoolWithoutConnect =
    typeof client.totalCount === "number" && typeof client.connect !== "function";
  if (looksLikePoolWithoutConnect) {
    if (!options.allowMutatingAnalyze) {
      throw new Error(
        "Refusing EXPLAIN ANALYZE: pooled PostgreSQL client lacks `.connect()` to pin a session for `BEGIN READ ONLY ... ROLLBACK`. Supply a pool with `.connect()`, a dedicated Client, or `{ allowMutatingAnalyze: true }`.",
      );
    }
    const res = await client.query(explainSql, params);
    const json = extractPostgresPlanJson(res.rows);
    const plan = await explainText(json, engine);
    if (plan.statement === null) plan.statement = sql;
    return plan;
  }

  // Dedicated single-session client (or mock client exposing `.query`)
  await client.query("BEGIN READ ONLY");
  let res: { rows: Record<string, unknown>[] };
  try {
    res = await client.query(explainSql, params);
  } finally {
    await client.query("ROLLBACK");
  }
  const json = extractPostgresPlanJson(res.rows);
  const plan = await explainText(json, engine);
  if (plan.statement === null) plan.statement = sql;
  return plan;
}

async function runPostgresUnsafeExplain(
  client: PostgresUnsafeClientLike,
  sql: string,
  params: unknown[],
  options: ExplainOptions,
): Promise<Plan> {
  const engine: Engine = options.engine === "yugabyte" ? "yugabyte" : "postgres";
  const analyze = options.analyze === true;
  const buffers = options.buffers ?? analyze;

  const formatOpts: string[] = [];
  if (analyze) formatOpts.push("ANALYZE");
  if (buffers) formatOpts.push("BUFFERS");
  formatOpts.push("FORMAT JSON");
  const explainSql = `EXPLAIN (${formatOpts.join(", ")}) ${sql}`;

  if (!analyze) {
    const rows = await client.unsafe(explainSql, params);
    const json = extractPostgresPlanJson(rows);
    const plan = await explainText(json, engine);
    if (plan.statement === null) plan.statement = sql;
    return plan;
  }

  if (typeof client.reserve === "function") {
    const reserved = await client.reserve();
    try {
      await reserved.unsafe("BEGIN READ ONLY");
      let rows: unknown[];
      try {
        rows = await reserved.unsafe(explainSql, params);
      } finally {
        await reserved.unsafe("ROLLBACK");
      }
      const json = extractPostgresPlanJson(rows);
      const plan = await explainText(json, engine);
      if (plan.statement === null) plan.statement = sql;
      return plan;
    } finally {
      await reserved.release?.();
    }
  }

  if (typeof client.begin === "function") {
    let capturedRows: unknown[] | undefined;
    try {
      await client.begin(async (tx) => {
        await tx.unsafe("SET TRANSACTION READ ONLY");
        const rows = await tx.unsafe(explainSql, params);
        throw new RollbackSentinel(rows);
      });
    } catch (err) {
      if (err instanceof RollbackSentinel) {
        capturedRows = err.rows;
      } else {
        throw err;
      }
    }
    const json = extractPostgresPlanJson(capturedRows ?? []);
    const plan = await explainText(json, engine);
    if (plan.statement === null) plan.statement = sql;
    return plan;
  }

  if (!options.allowMutatingAnalyze) {
    throw new Error(
      "Refusing EXPLAIN ANALYZE: PostgreSQL `.unsafe()` driver lacks `.reserve()` or `.begin()` transaction control for a safe `BEGIN READ ONLY ... ROLLBACK` wrapper. Provide transaction control or pass `{ allowMutatingAnalyze: true }`.",
    );
  }

  const rows = await client.unsafe(explainSql, params);
  const json = extractPostgresPlanJson(rows);
  const plan = await explainText(json, engine);
  if (plan.statement === null) plan.statement = sql;
  return plan;
}

function unwrapMysqlRows(rawResult: unknown): unknown[] {
  if (Array.isArray(rawResult)) {
    // mysql2/promise returns [rows, fields] where rows is itself an array
    if (rawResult.length >= 1 && Array.isArray(rawResult[0])) {
      return rawResult[0] as unknown[];
    }
    return rawResult;
  }
  if (rawResult !== null && typeof rawResult === "object" && "rows" in rawResult) {
    const r = (rawResult as { rows?: unknown }).rows;
    if (Array.isArray(r)) return r;
  }
  throw new Error("Unrecognized MySQL EXPLAIN result shape.");
}

async function runMysqlExplain(
  client: Mysql2ClientLike,
  sql: string,
  params: unknown[],
  options: ExplainOptions,
): Promise<Plan> {
  const analyze = options.analyze === true;
  const explainSql = analyze ? `EXPLAIN ANALYZE ${sql}` : `EXPLAIN FORMAT=JSON ${sql}`;
  const rawResult = await client.query(explainSql, params);
  const rows = unwrapMysqlRows(rawResult);

  if (rows.length === 0) {
    throw new Error("MySQL EXPLAIN returned zero rows.");
  }

  const lines = rows.map((row) => {
    if (typeof row === "string") return row;
    if (row !== null && typeof row === "object") {
      const rec = row as Record<string, unknown>;
      const val = rec.EXPLAIN ?? rec.explain ?? Object.values(rec)[0];
      if (typeof val === "string") return val;
      if (val !== null && typeof val === "object") return JSON.stringify(val);
    }
    throw new Error("Unrecognized MySQL EXPLAIN row payload.");
  });

  const rawPlan = lines.join("\n");
  const plan = await explainText(rawPlan, "mysql");
  if (plan.statement === null) {
    plan.statement = sql;
  }
  return plan;
}

async function runSqliteExplain(
  client: SqliteClientLike,
  sql: string,
  params: unknown[],
): Promise<Plan> {
  const explainSql = `EXPLAIN QUERY PLAN ${sql}`;
  let rows: unknown[];

  if ("prepare" in client && typeof client.prepare === "function") {
    const stmt = client.prepare(explainSql);
    const isD1Like =
      typeof stmt.bind === "function" &&
      "batch" in client &&
      typeof client.batch === "function";
    const rawOut = isD1Like
      ? await (params.length > 0 ? stmt.bind!(...params) : stmt).all()
      : await stmt.all(...params);
    if (Array.isArray(rawOut)) {
      rows = rawOut;
    } else if (
      rawOut !== null &&
      typeof rawOut === "object" &&
      "results" in rawOut &&
      Array.isArray((rawOut as { results?: unknown }).results)
    ) {
      rows = (rawOut as { results: unknown[] }).results;
    } else {
      throw new Error("Unrecognized SQLite `.prepare().all()` result shape.");
    }
  } else if ("all" in client && typeof client.all === "function") {
    const rawOut = await (params.length > 0 ? client.all(explainSql, params) : client.all(explainSql));
    if (!Array.isArray(rawOut)) {
      throw new Error("Unrecognized SQLite `.all()` result shape.");
    }
    rows = rawOut;
  } else if ("execute" in client && typeof client.execute === "function") {
    const rawOut = await client.execute({ sql: explainSql, args: params });
    rows = rawOut.rows;
  } else {
    throw new TypeError("Unsupported SQLite client: expected `.prepare()`, `.all()`, or `.execute()`.");
  }

  const treeText = formatSqliteExplainRows(rows);
  const plan = await explainText(treeText, "sqlite");
  if (plan.statement === null) {
    plan.statement = sql;
  }
  return plan;
}

/**
 * Runs `EXPLAIN` against a live database client (`pg`, `postgres.js`, `Bun.sql`, `mysql2`,
 * `better-sqlite3`, `node:sqlite`, `bun:sqlite`, LibSQL, or Cloudflare D1) and parses the
 * resulting plan into a typed `@culpritsql/plans` `Plan`.
 */
export async function explain(
  client: SupportedDriverClient,
  query: QueryInput,
  options?: ExplainOptions,
): Promise<Plan>;
export async function explain(
  client: SupportedDriverClient,
  query: QueryInput,
  params: QueryParams | undefined,
  options?: ExplainOptions,
): Promise<Plan>;
export async function explain(
  client: SupportedDriverClient,
  query: QueryInput,
  paramsOrOptions?: QueryParams | ExplainOptions,
  maybeOptions?: ExplainOptions,
): Promise<Plan> {
  const { rawSql } = extractRawQuery(query);

  let params: QueryParams | undefined;
  let options: ExplainOptions;

  if (maybeOptions !== undefined) {
    params = paramsOrOptions as QueryParams | undefined;
    options = maybeOptions;
  } else if (isExplainOptionsCandidate(paramsOrOptions, rawSql)) {
    params = undefined;
    options = paramsOrOptions;
  } else {
    params = paramsOrOptions as QueryParams | undefined;
    options = {};
  }

  if (options.engine === "mssql") {
    throw new Error(
      "Direct SQL Server driver execution is not bundled in `explain()`; capture `.sqlplan` Showplan XML and pass it to `explainText(xml, \"mssql\")`.",
    );
  }

  const driver = detectDriverKind(client, options.engine);
  const paramStyle: ParameterStyle =
    driver === "pg" || driver === "postgres-unsafe" ? "dollar" : "question";
  const normalized = normalizeQuery(query, params, paramStyle);

  switch (driver) {
    case "pg":
      return runPgExplain(client as PgClientLike, normalized.sql, normalized.params, options);
    case "postgres-unsafe":
      return runPostgresUnsafeExplain(
        client as PostgresUnsafeClientLike,
        normalized.sql,
        normalized.params,
        options,
      );
    case "mysql2":
      return runMysqlExplain(
        client as Mysql2ClientLike,
        normalized.sql,
        normalized.params,
        options,
      );
    case "sqlite":
      return runSqliteExplain(client as SqliteClientLike, normalized.sql, normalized.params);
  }
}
