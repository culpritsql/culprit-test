import { beforeAll, describe, expect, test } from "bun:test";
import {
  assertPlan,
  bindNamedParams,
  culpritMatchers,
  diffPlans,
  explain,
  explainText,
  formatSqliteExplainRows,
  initWasm,
  isWasmReady,
  normalizeQuery,
  ParserError,
  PlanAssertionError,
  parsePlan,
  validateSingleStatementSql,
  type PgPoolClientLike,
  type ReyloQueryModule,
  type SqlQueryBuilder,
} from "../src/index.js";
import {
  MSSQL_IMPLICIT_SQLPLAN,
  MSSQL_MISSING_INDEX_SQLPLAN,
  MSSQL_SEEK_SQLPLAN,
  MSSQL_SORT_SPILL_SQLPLAN,
  MYSQL_ANALYZE_TREE,
  MYSQL_INDEX_JSON,
  MYSQL_SCAN_JSON,
  PG_FAST_ANALYZE_JSON,
  PG_INDEX_JSON,
  PG_SEQSCAN_JSON,
  PG_SORT_SPILL_JSON,
  SQLITE_COVERING_INDEX_TEXT,
  SQLITE_INDEX_TEXT,
  SQLITE_SCAN_TEXT,
} from "./fixtures.js";

expect.extend(culpritMatchers);

beforeAll(async () => {
  await initWasm();
});

describe("Wasm initialization & raw plan parsing", () => {
  test("initializes @culpritsql/plans Wasm once and parses all 5 engine formats", async () => {
    expect(isWasmReady()).toBe(true);

    const pgPlan = await explainText(PG_INDEX_JSON, "postgres");
    expect(pgPlan.engine).toBe("postgres");
    expect(pgPlan.total_cost).toBeCloseTo(15.52, 2);

    const mssqlPlan = await explainText(MSSQL_SEEK_SQLPLAN, "mssql");
    expect(mssqlPlan.engine).toBe("mssql");

    const mysqlPlan = await explainText(MYSQL_INDEX_JSON, "mysql");
    expect(mysqlPlan.engine).toBe("mysql");

    const sqlitePlan = await explainText(SQLITE_INDEX_TEXT, "sqlite");
    expect(sqlitePlan.engine).toBe("sqlite");

    const syncPlan = parsePlan(SQLITE_SCAN_TEXT, "sqlite");
    expect(syncPlan.engine).toBe("sqlite");

    const diff = diffPlans(pgPlan, "Index", await explainText(PG_SEQSCAN_JSON, "postgres"), "Scan");
    expect(diff.comparable).toBe(true);
  });

  test("rejects empty or malformed plan text cleanly", async () => {
    await expect(explainText("   ")).rejects.toThrow(/empty execution plan/i);
    await expect(explainText("{not valid json", "postgres")).rejects.toBeInstanceOf(ParserError);
  });
});

describe("Query normalization, Reylo, Drizzle/Kysely, named params, and SQL injection guards", () => {
  test("normalizes raw SQL strings and strips a single trailing semicolon", () => {
    const res = normalizeQuery("  SELECT * FROM orders WHERE id = $1;  ", [99]);
    expect(res.sql).toBe("SELECT * FROM orders WHERE id = $1");
    expect(res.params).toEqual([99]);
  });

  test("supports Reylo { sql } and { raw } query modules", () => {
    const reyloModule: ReyloQueryModule = {
      sql: "SELECT id, total FROM orders WHERE customer_id = $1 AND status = $2;",
      params: [7, "shipped"],
    };
    const normalized = normalizeQuery(reyloModule);
    expect(normalized.sql).toBe(
      "SELECT id, total FROM orders WHERE customer_id = $1 AND status = $2",
    );
    expect(normalized.params).toEqual([7, "shipped"]);

    const reyloRaw: ReyloQueryModule = {
      raw: "SELECT id FROM customers WHERE email = $1",
    };
    const overridden = normalizeQuery(reyloRaw, ["a@example.com"]);
    expect(overridden.sql).toBe("SELECT id FROM customers WHERE email = $1");
    expect(overridden.params).toEqual(["a@example.com"]);
  });

  test("supports Drizzle / Kysely / Knex .toSQL() builders with params and bindings", () => {
    const drizzleBuilder: SqlQueryBuilder = {
      toSQL() {
        return {
          sql: 'select "id", "status" from "orders" where "orders"."status" = $1 limit $2',
          params: ["shipped", 20],
        };
      },
    };
    const dNorm = normalizeQuery(drizzleBuilder);
    expect(dNorm.sql).toContain('from "orders"');
    expect(dNorm.params).toEqual(["shipped", 20]);

    const knexBuilder: SqlQueryBuilder = {
      toSQL() {
        return {
          sql: "select `id` from `orders` where `status` = ?",
          bindings: ["pending"],
        };
      },
    };
    const kNorm = normalizeQuery(knexBuilder, undefined, "question");
    expect(kNorm.params).toEqual(["pending"]);
  });

  test("binds :named and $named parameters while preserving casts, literals, dollar quotes, and comments", () => {
    const sql = [
      "SELECT id, created_at::text, 'literal :ignored $ignored' AS note, $$raw :ignored$$ AS body",
      "-- comment with :ignored_comment",
      "/* block :ignored_block */",
      "FROM orders",
      "WHERE customer_id = :customerId AND status = $status AND updated_by = :customerId",
    ].join("\n");

    const pgBound = bindNamedParams(sql, { customerId: 42, status: "shipped" }, "dollar");
    expect(pgBound.sql).toContain("created_at::text");
    expect(pgBound.sql).toContain("'literal :ignored $ignored'");
    expect(pgBound.sql).toContain("$$raw :ignored$$");
    expect(pgBound.sql).toContain("customer_id = $1 AND status = $2 AND updated_by = $1");
    expect(pgBound.params).toEqual([42, "shipped"]);

    const sqliteBound = bindNamedParams(sql, { customerId: 42, status: "shipped" }, "question");
    expect(sqliteBound.sql).toContain("customer_id = ? AND status = ? AND updated_by = ?");
    expect(sqliteBound.params).toEqual([42, "shipped", 42]);

    expect(() => bindNamedParams("SELECT * FROM orders WHERE id = :missingId", {})).toThrow(
      /Missing value for named SQL parameter "missingId"/,
    );
  });

  test("rejects empty SQL and multi-statement SQL injection attempts", () => {
    expect(() => validateSingleStatementSql("")).toThrow(/empty SQL/i);
    expect(() => validateSingleStatementSql("   -- only a comment\n /* nothing */ ")).toThrow(
      /empty SQL/i,
    );
    expect(() => validateSingleStatementSql(";")).toThrow(/empty SQL/i);
    expect(() =>
      validateSingleStatementSql("SELECT * FROM orders; DROP TABLE orders;"),
    ).toThrow(/Multi-statement SQL/i);
    expect(() =>
      validateSingleStatementSql("SELECT 1; DELETE FROM customers WHERE 1=1"),
    ).toThrow(/Multi-statement SQL/i);

    // Semicolons inside string literals or comments are safe and permitted
    expect(validateSingleStatementSql("SELECT 'a;b' AS safe_literal FROM orders;")).toBe(
      "SELECT 'a;b' AS safe_literal FROM orders",
    );
  });
});

describe("Database driver adapters (pg, postgres.js, mysql2, better-sqlite3, D1, LibSQL)", () => {
  test("mock pg pool runs EXPLAIN (FORMAT JSON) by default and wraps analyze: true in BEGIN READ ONLY ... ROLLBACK", async () => {
    const executedLog: Array<{ sql: string; values?: unknown[] }> = [];
    let releasedCount = 0;

    const mockPool = {
      totalCount: 4,
      async query(text: string, values?: unknown[]) {
        executedLog.push({ sql: text, values });
        return { rows: [{ "QUERY PLAN": JSON.parse(PG_INDEX_JSON) }] };
      },
      async connect(): Promise<PgPoolClientLike> {
        return {
          async query(text: string, values?: unknown[]) {
            executedLog.push({ sql: text, values });
            if (text.startsWith("EXPLAIN")) {
              return { rows: [{ "QUERY PLAN": JSON.parse(PG_FAST_ANALYZE_JSON) }] };
            }
            return { rows: [] };
          },
          release() {
            releasedCount += 1;
          },
        };
      },
    };

    // 1. Estimated mode (no transaction needed)
    const estPlan = await explain(
      mockPool,
      { sql: "SELECT * FROM orders WHERE status = $1 LIMIT 20" },
      ["shipped"],
    );
    expect(executedLog).toEqual([
      {
        sql: "EXPLAIN (FORMAT JSON) SELECT * FROM orders WHERE status = $1 LIMIT 20",
        values: ["shipped"],
      },
    ]);
    expect(estPlan).toUseIndex("orders_status_created_idx");
    expect(releasedCount).toBe(0);

    // 2. Analyze mode (pins client, wraps in BEGIN READ ONLY ... ROLLBACK, releases client)
    executedLog.length = 0;
    const actualPlan = await explain(
      mockPool,
      "SELECT id FROM orders WHERE status = :status",
      { status: "shipped" },
      { analyze: true },
    );
    expect(executedLog).toEqual([
      { sql: "BEGIN READ ONLY", values: undefined },
      {
        sql: "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM orders WHERE status = $1",
        values: ["shipped"],
      },
      { sql: "ROLLBACK", values: undefined },
    ]);
    expect(releasedCount).toBe(1);
    expect(actualPlan).toCompleteWithin(5);
    expect(actualPlan).toReadAtMostPages(10);
  });

  test("refuses PostgreSQL analyze: true when driver lacks transaction control unless allowMutatingAnalyze: true", async () => {
    const unsafeCalls: string[] = [];
    const statelessPostgresJs = {
      async unsafe(query: string) {
        unsafeCalls.push(query);
        return [{ "QUERY PLAN": JSON.parse(PG_FAST_ANALYZE_JSON) }];
      },
    };

    await expect(
      explain(statelessPostgresJs, "SELECT * FROM orders", { analyze: true }),
    ).rejects.toThrow(/Refusing EXPLAIN ANALYZE/);
    expect(unsafeCalls).toHaveLength(0);

    // Allowed when explicitly opted in
    const plan = await explain(statelessPostgresJs, "SELECT * FROM orders", {
      analyze: true,
      allowMutatingAnalyze: true,
    });
    expect(unsafeCalls).toEqual(["EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM orders"]);
    expect(plan).toUseIndex("orders_status_created_idx");

    // Pooled pg client without connect() is also refused unless opted in
    const poolWithoutConnect = {
      totalCount: 10,
      async query() {
        return { rows: [{ "QUERY PLAN": JSON.parse(PG_FAST_ANALYZE_JSON) }] };
      },
    };
    await expect(
      explain(poolWithoutConnect, "SELECT * FROM orders", { analyze: true }),
    ).rejects.toThrow(/Refusing EXPLAIN ANALYZE/);
  });

  test("supports postgres.js / Bun.sql with reserve() and begin() read-only rollback", async () => {
    const reserveLog: string[] = [];
    let released = false;

    const mockPostgresJsReserve = Object.assign(
      () => {
        throw new Error("template call unused");
      },
      {
        async unsafe(query: string) {
          reserveLog.push(`pool:${query}`);
          return [{ "QUERY PLAN": JSON.parse(PG_INDEX_JSON) }];
        },
        async reserve() {
          return {
            async unsafe(query: string) {
              reserveLog.push(`conn:${query}`);
              if (query.startsWith("EXPLAIN")) {
                return [{ "QUERY PLAN": JSON.parse(PG_FAST_ANALYZE_JSON) }];
              }
              return [];
            },
            release() {
              released = true;
            },
          };
        },
      },
    );

    const est = await explain(mockPostgresJsReserve, "SELECT * FROM orders WHERE status = 'shipped'");
    expect(est).toUseIndex("orders_status_created_idx");
    expect(reserveLog).toEqual([
      "pool:EXPLAIN (FORMAT JSON) SELECT * FROM orders WHERE status = 'shipped'",
    ]);

    reserveLog.length = 0;
    const act = await explain(mockPostgresJsReserve, "SELECT * FROM orders", { analyze: true });
    expect(act).toCompleteWithin(1);
    expect(released).toBe(true);
    expect(reserveLog).toEqual([
      "conn:BEGIN READ ONLY",
      "conn:EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM orders",
      "conn:ROLLBACK",
    ]);

    // Also test .begin() transaction rollback flow
    const beginLog: string[] = [];
    let rolledBack = false;
    const mockPostgresJsBegin = {
      async unsafe(query: string) {
        beginLog.push(query);
        return [];
      },
      async begin<T>(
        fn: (tx: { unsafe(q: string, p?: unknown[]): Promise<unknown[]> }) => Promise<T>,
      ): Promise<T> {
        try {
          return await fn({
            async unsafe(q: string) {
              beginLog.push(q);
              if (q.startsWith("EXPLAIN")) {
                return [{ "QUERY PLAN": PG_FAST_ANALYZE_JSON }];
              }
              return [];
            },
          });
        } catch (err) {
          rolledBack = true;
          throw err;
        }
      },
    };

    const viaBegin = await explain(mockPostgresJsBegin, "SELECT * FROM orders", { analyze: true });
    expect(rolledBack).toBe(true);
    expect(beginLog).toEqual([
      "SET TRANSACTION READ ONLY",
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM orders",
    ]);
    expect(viaBegin).toUseIndex("orders_status_created_idx");
  });

  test("supports mysql2 promise pool/connection for EXPLAIN FORMAT=JSON and EXPLAIN ANALYZE", async () => {
    const mysqlLog: Array<{ sql: string; values?: unknown[] }> = [];
    const mockMysql2 = {
      async query(sql: string, values?: unknown[]) {
        mysqlLog.push({ sql, values });
        if (sql.startsWith("EXPLAIN ANALYZE")) {
          return [[{ EXPLAIN: MYSQL_ANALYZE_TREE }], []];
        }
        return [[{ EXPLAIN: MYSQL_INDEX_JSON }], []];
      },
      async execute(sql: string, values?: unknown[]) {
        return this.query(sql, values);
      },
    };

    const drizzleMysql: SqlQueryBuilder = {
      toSQL() {
        return {
          sql: "SELECT id, total FROM orders WHERE status = ?",
          params: ["shipped"],
        };
      },
    };

    const estPlan = await explain(mockMysql2, drizzleMysql);
    expect(mysqlLog[0]).toEqual({
      sql: "EXPLAIN FORMAT=JSON SELECT id, total FROM orders WHERE status = ?",
      values: ["shipped"],
    });
    expect(estPlan.engine).toBe("mysql");
    expect(estPlan).toUseIndex("ix_orders_status_created");
    expect(estPlan).not.toScanTable("orders");

    const analyzePlan = await explain(mockMysql2, drizzleMysql, { analyze: true });
    expect(mysqlLog[1]?.sql).toBe(
      "EXPLAIN ANALYZE SELECT id, total FROM orders WHERE status = ?",
    );
    expect(analyzePlan.engine).toBe("mysql");
    expect(analyzePlan.kind).toBe("actual");
  });

  test("supports better-sqlite3, Cloudflare D1, and LibSQL EXPLAIN QUERY PLAN row trees", async () => {
    const sqliteCalls: Array<{ sql: string; params: unknown[] }> = [];
    const mockBetterSqlite3 = {
      prepare(sql: string) {
        return {
          all(...params: unknown[]) {
            sqliteCalls.push({ sql, params });
            return [
              { id: 2, parent: 0, notused: 0, detail: "CO-ROUTINE recent_orders" },
              {
                id: 5,
                parent: 2,
                notused: 0,
                detail: "SEARCH orders USING INDEX orders_customer_idx (customer_id=?)",
              },
              { id: 9, parent: 0, notused: 0, detail: "SCAN recent_orders" },
            ];
          },
        };
      },
    };

    const tree = formatSqliteExplainRows([
      { id: 2, parent: 0, notused: 0, detail: "CO-ROUTINE recent_orders" },
      {
        id: 5,
        parent: 2,
        notused: 0,
        detail: "SEARCH orders USING INDEX orders_customer_idx (customer_id=?)",
      },
      { id: 9, parent: 0, notused: 0, detail: "SCAN recent_orders" },
    ]);
    expect(tree).toBe(
      [
        "QUERY PLAN",
        "|--CO-ROUTINE recent_orders",
        "|  `--SEARCH orders USING INDEX orders_customer_idx (customer_id=?)",
        "`--SCAN recent_orders",
      ].join("\n"),
    );

    const sqlitePlan = await explain(
      mockBetterSqlite3,
      "SELECT * FROM orders WHERE customer_id = :cid",
      { cid: 42 },
    );
    expect(sqliteCalls).toEqual([
      {
        sql: "EXPLAIN QUERY PLAN SELECT * FROM orders WHERE customer_id = ?",
        params: [42],
      },
    ]);
    expect(sqlitePlan.engine).toBe("sqlite");
    expect(sqlitePlan).toUseIndex("orders_customer_idx");
    expect(sqlitePlan).not.toScanTable("orders");
    expect(sqlitePlan).toScanTable("recent_orders");

    // LibSQL .execute({ sql, args })
    const mockLibSql = {
      async execute(stmt: { sql: string; args?: unknown[] } | string) {
        const sqlText = typeof stmt === "string" ? stmt : stmt.sql;
        expect(sqlText).toBe("EXPLAIN QUERY PLAN SELECT * FROM orders");
        return {
          rows: [{ id: 2, parent: 0, notused: 0, detail: "SCAN orders" }],
        };
      },
    };
    const libsqlPlan = await explain(mockLibSql, "SELECT * FROM orders");
    expect(libsqlPlan).toScanTable("orders");

    // Cloudflare D1 .prepare(sql).bind(...params).all() -> { results }
    let boundArgs: unknown[] = [];
    const mockD1 = {
      async batch() {
        return [];
      },
      prepare(sql: string) {
        expect(sql).toBe("EXPLAIN QUERY PLAN SELECT * FROM orders WHERE customer_id = ?");
        return {
          bind(...params: unknown[]) {
            boundArgs = params;
            return this;
          },
          async all() {
            return {
              results: [
                {
                  id: 3,
                  parent: 0,
                  notused: 0,
                  detail: "SEARCH orders USING INDEX orders_customer_idx (customer_id=?)",
                },
              ],
            };
          },
        };
      },
    };
    const d1Plan = await explain(mockD1, "SELECT * FROM orders WHERE customer_id = ?", [101]);
    expect(boundArgs).toEqual([101]);
    expect(d1Plan).toUseIndex("orders_customer_idx");
  });
});

describe("All matchers (expect.extend + assertPlan, positive + .not negation, and rich diagnostics)", () => {
  test("toUseIndex and toScanTable across Postgres, SQL Server, MySQL, and SQLite", async () => {
    const pgIndex = await explainText(PG_INDEX_JSON, "postgres");
    const pgScan = await explainText(PG_SEQSCAN_JSON, "postgres");
    const mssqlSeek = await explainText(MSSQL_SEEK_SQLPLAN, "mssql");
    const mssqlMissing = await explainText(MSSQL_MISSING_INDEX_SQLPLAN, "mssql");
    const mysqlScan = await explainText(MYSQL_SCAN_JSON, "mysql");
    const mysqlIndex = await explainText(MYSQL_INDEX_JSON, "mysql");
    const sqliteScan = await explainText(SQLITE_SCAN_TEXT, "sqlite");
    const sqliteCover = await explainText(SQLITE_COVERING_INDEX_TEXT, "sqlite");

    // Positive & negated expect.extend matchers
    expect(pgIndex).toUseIndex();
    expect(pgIndex).toUseIndex("orders_status_created_idx");
    expect(pgIndex).toUseIndex(/^orders_status/);
    expect(pgIndex).not.toUseIndex("nonexistent_idx");
    expect(pgIndex).not.toScanTable("orders");
    expect(pgIndex).not.toScanTable();

    expect(pgScan).toScanTable();
    expect(pgScan).toScanTable("orders");
    expect(pgScan).toScanTable(/customers/);
    expect(pgScan).not.toScanTable("invoices");
    expect(pgScan).not.toUseIndex();

    expect(mssqlSeek).toUseIndex("ix_customers_email");
    expect(mssqlSeek).not.toScanTable("customers");

    expect(mssqlMissing).toScanTable("orders");
    expect(mssqlMissing).toScanTable("shop.orders");
    expect(mssqlMissing).not.toUseIndex();

    expect(mysqlScan).toScanTable("orders");
    expect(mysqlScan).not.toUseIndex();
    expect(mysqlIndex).toUseIndex("ix_orders_status_created");
    expect(mysqlIndex).not.toScanTable("orders");

    expect(sqliteScan).toScanTable("orders");
    expect(sqliteScan).not.toUseIndex();
    expect(sqliteCover).toUseIndex("orders_status_covering_idx");
    expect(sqliteCover).not.toScanTable("orders");

    // Fluent assertPlan chaining with .not
    assertPlan(pgIndex)
      .toUseIndex("orders_status_created_idx")
      .not.toScanTable("orders")
      .toCostLessThan(50);

    // Rich failure diagnostics include offending node id, operator, object, row count, and index hints
    expect(() => assertPlan(mssqlMissing).not.toScanTable("orders")).toThrow(PlanAssertionError);
    try {
      assertPlan(mssqlMissing).not.toScanTable("orders");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("[node #");
      expect(msg).toContain("Clustered Index Scan");
      expect(msg).toContain("shop.orders");
      expect(msg).toContain("est_rows=");
      expect(msg).toContain("Index hint on");
      expect(msg).toContain("channel");
    }
  });

  test("toHaveZeroSpills positive, negated, and failure diagnostics on Postgres and SQL Server spills", async () => {
    const pgFast = await explainText(PG_FAST_ANALYZE_JSON, "postgres");
    const pgSpill = await explainText(PG_SORT_SPILL_JSON, "postgres");
    const mssqlSpill = await explainText(MSSQL_SORT_SPILL_SQLPLAN, "mssql");

    expect(pgFast).toHaveZeroSpills();
    expect(pgSpill).not.toHaveZeroSpills();
    expect(mssqlSpill).not.toHaveZeroSpills();

    assertPlan(pgFast).toHaveZeroSpills();
    assertPlan(pgSpill).not.toHaveZeroSpills();

    expect(() => assertPlan(pgSpill).toHaveZeroSpills()).toThrow(/spill_pages=83905/);
    expect(() => assertPlan(mssqlSpill).toHaveZeroSpills()).toThrow(/Sort/);
  });

  test("toCostLessThan, toCompleteWithin, and toReadAtMostPages positive and negated", async () => {
    const pgFast = await explainText(PG_FAST_ANALYZE_JSON, "postgres");
    const pgSpill = await explainText(PG_SORT_SPILL_JSON, "postgres");
    const mssqlSpill = await explainText(MSSQL_SORT_SPILL_SQLPLAN, "mssql");

    // Cost checks
    expect(pgFast).toCostLessThan(20);
    expect(pgFast).not.toCostLessThan(5);
    assertPlan(pgFast).toCostLessThan(20).not.toCostLessThan(5);

    // Elapsed ms checks
    expect(pgFast).toCompleteWithin(1);
    expect(pgSpill).not.toCompleteWithin(500);
    expect(pgSpill).toCompleteWithin(2000);
    assertPlan(pgFast).toCompleteWithin(1);
    assertPlan(pgSpill).not.toCompleteWithin(500);

    // Logical page / buffer read checks
    expect(pgFast).toReadAtMostPages(4);
    expect(pgFast).not.toReadAtMostPages(2);
    expect(pgSpill).not.toReadAtMostPages(1000);
    expect(mssqlSpill).toReadAtMostPages(5000);
    expect(mssqlSpill).not.toReadAtMostPages(2000);

    assertPlan(mssqlSpill).toReadAtMostPages(4313).not.toReadAtMostPages(4000);

    // Unmeasured estimated plans throw an explicit error on runtime-only assertions
    const pgEstimated = await explainText(PG_INDEX_JSON, "postgres");
    expect(() => assertPlan(pgEstimated).toCompleteWithin(10)).toThrow(/no measured elapsed_ms/);
    expect(() => assertPlan(pgEstimated).toReadAtMostPages(10)).toThrow(/no logical_reads/);
  });

  test("toHaveZeroWarnings catches SQL Server CONVERT_IMPLICIT and spill warnings", async () => {
    const mssqlSeek = await explainText(MSSQL_SEEK_SQLPLAN, "mssql");
    const mssqlImplicit = await explainText(MSSQL_IMPLICIT_SQLPLAN, "mssql");
    const pgSpill = await explainText(PG_SORT_SPILL_JSON, "postgres");

    expect(mssqlSeek).toHaveZeroWarnings();
    expect(mssqlImplicit).not.toHaveZeroWarnings();
    expect(pgSpill).not.toHaveZeroWarnings();

    assertPlan(mssqlSeek).toHaveZeroWarnings();
    assertPlan(mssqlImplicit).not.toHaveZeroWarnings();

    expect(() => assertPlan(mssqlImplicit).toHaveZeroWarnings()).toThrow(/CONVERT_IMPLICIT/);
  });

  test("toNotRegressFrom detects cost spikes and scan flips while allowing improvements", async () => {
    const pgIndex = await explainText(PG_INDEX_JSON, "postgres");
    const pgScan = await explainText(PG_SEQSCAN_JSON, "postgres");
    const mssqlSeek = await explainText(MSSQL_SEEK_SQLPLAN, "mssql");
    const mssqlImplicit = await explainText(MSSQL_IMPLICIT_SQLPLAN, "mssql");
    const sqliteIndex = await explainText(SQLITE_INDEX_TEXT, "sqlite");
    const sqliteScan = await explainText(SQLITE_SCAN_TEXT, "sqlite");

    // Identical or improved plans pass
    expect(pgIndex).toNotRegressFrom(pgIndex);
    expect(pgIndex).toNotRegressFrom(pgScan);
    expect(mssqlSeek).toNotRegressFrom(mssqlImplicit);
    expect(sqliteIndex).toNotRegressFrom(sqliteScan);

    // Regressed plans (Index -> Seq Scan / cost spike / SQLite SEARCH -> SCAN) fail positive and pass .not
    expect(pgScan).not.toNotRegressFrom(pgIndex);
    expect(mssqlImplicit).not.toNotRegressFrom(mssqlSeek);
    expect(sqliteScan).not.toNotRegressFrom(sqliteIndex);

    assertPlan(pgIndex).toNotRegressFrom(pgScan);
    assertPlan(pgScan).not.toNotRegressFrom(pgIndex);
    assertPlan(sqliteScan).not.toNotRegressFrom(sqliteIndex);

    // Custom options: allowScanFlip + generous maxCostRatio allows controlled changes
    expect(sqliteScan).toNotRegressFrom(sqliteIndex, { allowScanFlip: true });
    expect(pgScan).toNotRegressFrom(pgIndex, {
      allowScanFlip: true,
      maxCostRatio: 10000,
    });

    expect(() => assertPlan(pgScan).toNotRegressFrom(pgIndex)).toThrow(/Cost spike/);
  });

  test("bundled dist/index.js ESM entrypoint exports the full public API and executes cleanly", async () => {
    const distUrl = new URL("../dist/index.js", import.meta.url).href;
    const distPkg = (await import(distUrl)) as typeof import("../src/index.js");
    const plan = await distPkg.explainText(PG_INDEX_JSON, "postgres");
    distPkg
      .assertPlan(plan)
      .toUseIndex("orders_status_created_idx")
      .not.toScanTable("orders")
      .toHaveZeroSpills()
      .toHaveZeroWarnings();
  });
});

