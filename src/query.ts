/** Reylo `.sql` module shape (`{ sql: string }` or `{ raw: string }`). */
export type ReyloQueryModule =
  | { readonly sql: string; readonly params?: readonly unknown[] }
  | { readonly raw: string; readonly params?: readonly unknown[] };

/** Drizzle, Kysely, or Knex query builder exposing `.toSQL()`. */
export interface SqlQueryBuilder {
  toSQL(): {
    readonly sql: string;
    readonly params?: readonly unknown[];
    readonly bindings?: readonly unknown[];
  };
}

/** Any SQL input accepted by `explain()` and `normalizeQuery()`. */
export type QueryInput = string | ReyloQueryModule | SqlQueryBuilder;

/** Positional parameter list or named parameter dictionary (`:name` / `$name`). */
export type QueryParams = readonly unknown[] | Readonly<Record<string, unknown>>;

/** Placeholder output dialect used when binding named parameters. */
export type ParameterStyle = "dollar" | "question";

export interface NormalizedQuery {
  sql: string;
  params: unknown[];
}

function isIdentStart(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

function matchDollarQuoteTag(sql: string, start: number): string | null {
  if (sql[start] !== "$") return null;
  let i = start + 1;
  if (i < sql.length && sql[i] === "$") {
    return "$$";
  }
  if (i >= sql.length || !isIdentStart(sql[i]!)) {
    return null;
  }
  while (i < sql.length && isIdentPart(sql[i]!)) {
    i += 1;
  }
  if (i < sql.length && sql[i] === "$") {
    return sql.slice(start, i + 1);
  }
  return null;
}

/**
 * Validates that `rawSql` contains exactly one non-empty SQL statement and strips any trailing
 * statement terminator so it can be safely prefixed with `EXPLAIN`.
 */
export function validateSingleStatementSql(rawSql: string): string {
  const trimmed = rawSql.trim();
  if (trimmed.length === 0) {
    throw new Error("Cannot run EXPLAIN on an empty SQL statement.");
  }

  let hasMeaningfulToken = false;
  let firstSemicolonAt = -1;
  let i = 0;

  while (i < trimmed.length) {
    const ch = trimmed[i]!;
    const next = trimmed[i + 1];

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }

    // Line comment: -- ...
    if (ch === "-" && next === "-") {
      i += 2;
      while (i < trimmed.length && trimmed[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    // Block comment: /* ... */
    if (ch === "/" && next === "*") {
      const end = trimmed.indexOf("*/", i + 2);
      if (end === -1) {
        throw new Error("Unterminated SQL block comment in EXPLAIN query.");
      }
      i = end + 2;
      continue;
    }

    // Semicolon outside quotes and comments
    if (ch === ";") {
      if (!hasMeaningfulToken) {
        throw new Error("Cannot run EXPLAIN on an empty SQL statement.");
      }
      if (firstSemicolonAt === -1) {
        firstSemicolonAt = i;
      } else {
        throw new Error("Multi-statement SQL is not permitted when wrapping EXPLAIN.");
      }
      i += 1;
      continue;
    }

    if (firstSemicolonAt !== -1) {
      throw new Error("Multi-statement SQL is not permitted when wrapping EXPLAIN.");
    }

    hasMeaningfulToken = true;

    // Single-quoted string literal
    if (ch === "'") {
      i += 1;
      while (i < trimmed.length) {
        const c = trimmed[i]!;
        if (c === "\\" && i + 1 < trimmed.length) {
          i += 2;
          continue;
        }
        if (c === "'" && trimmed[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (c === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // Double-quoted identifier
    if (ch === '"') {
      i += 1;
      while (i < trimmed.length) {
        if (trimmed[i] === '"' && trimmed[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (trimmed[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // Backtick-quoted identifier
    if (ch === "`") {
      i += 1;
      while (i < trimmed.length) {
        if (trimmed[i] === "`" && trimmed[i + 1] === "`") {
          i += 2;
          continue;
        }
        if (trimmed[i] === "`") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // Bracket-quoted identifier
    if (ch === "[") {
      const end = trimmed.indexOf("]", i + 1);
      i = end === -1 ? trimmed.length : end + 1;
      continue;
    }

    // PostgreSQL dollar-quoted literal ($tag$...$tag$ or $$...$$)
    if (ch === "$") {
      const tag = matchDollarQuoteTag(trimmed, i);
      if (tag !== null) {
        const end = trimmed.indexOf(tag, i + tag.length);
        if (end === -1) {
          throw new Error(`Unterminated dollar-quoted SQL literal (${tag}) in EXPLAIN query.`);
        }
        i = end + tag.length;
        continue;
      }
    }

    i += 1;
  }

  if (!hasMeaningfulToken) {
    throw new Error("Cannot run EXPLAIN on an empty SQL statement.");
  }

  if (firstSemicolonAt !== -1) {
    return trimmed.slice(0, firstSemicolonAt).trimEnd();
  }

  return trimmed;
}

/**
 * Extracts all named parameter identifiers (`:param` or `$param`) outside SQL literals,
 * quoted identifiers, PostgreSQL `::` casts, and comments.
 */
export function extractNamedParameters(sql: string): Set<string> {
  const names = new Set<string>();
  scanSqlWithNamedParams(sql, (name) => {
    names.add(name);
    return name;
  });
  return names;
}

/**
 * Substitutes named `:param` and `$param` placeholders with driver-native positional placeholders
 * (`$1, $2, ...` for PostgreSQL/YugabyteDB or `?` for MySQL/SQLite) while leaving string literals,
 * `::type` casts, positional `$1` parameters, and comments untouched.
 */
export function bindNamedParams(
  sql: string,
  named: Readonly<Record<string, unknown>>,
  style: ParameterStyle = "dollar",
): NormalizedQuery {
  const params: unknown[] = [];
  const dollarPositions = new Map<string, number>();

  const rewritten = scanSqlWithNamedParams(sql, (name) => {
    if (!Object.hasOwn(named, name)) {
      throw new Error(`Missing value for named SQL parameter "${name}".`);
    }
    const value = named[name];
    if (style === "dollar") {
      const existing = dollarPositions.get(name);
      if (existing !== undefined) {
        return `$${existing}`;
      }
      params.push(value);
      const index = params.length;
      dollarPositions.set(name, index);
      return `$${index}`;
    }
    params.push(value);
    return "?";
  });

  return { sql: rewritten, params };
}

function scanSqlWithNamedParams(
  sql: string,
  onParam: (name: string, prefix: ":" | "$") => string,
): string {
  let out = "";
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    // Line comment
    if (ch === "-" && next === "-") {
      const nl = sql.indexOf("\n", i + 2);
      const end = nl === -1 ? sql.length : nl + 1;
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      const endIdx = sql.indexOf("*/", i + 2);
      const end = endIdx === -1 ? sql.length : endIdx + 2;
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    // Single-quoted literal
    if (ch === "'") {
      const start = i;
      i += 1;
      while (i < sql.length) {
        const c = sql[i]!;
        if (c === "\\" && i + 1 < sql.length) {
          i += 2;
          continue;
        }
        if (c === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (c === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      out += sql.slice(start, i);
      continue;
    }

    // Double-quoted or backtick identifier
    if (ch === '"' || ch === "`") {
      const quote = ch;
      const start = i;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === quote && sql[i + 1] === quote) {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      out += sql.slice(start, i);
      continue;
    }

    // Bracket identifier
    if (ch === "[") {
      const endIdx = sql.indexOf("]", i + 1);
      const end = endIdx === -1 ? sql.length : endIdx + 1;
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    // PostgreSQL type cast :: or assignment :=
    if (ch === ":" && (next === ":" || next === "=")) {
      out += sql.slice(i, i + 2);
      i += 2;
      continue;
    }

    // Dollar-quoted literal vs $namedParam
    if (ch === "$") {
      const tag = matchDollarQuoteTag(sql, i);
      if (tag !== null) {
        const closeIdx = sql.indexOf(tag, i + tag.length);
        const end = closeIdx === -1 ? sql.length : closeIdx + tag.length;
        out += sql.slice(i, end);
        i = end;
        continue;
      }
      if (next !== undefined && isIdentStart(next) && (i === 0 || !isIdentPart(sql[i - 1]!))) {
        let end = i + 2;
        while (end < sql.length && isIdentPart(sql[end]!)) {
          end += 1;
        }
        const name = sql.slice(i + 1, end);
        out += onParam(name, "$");
        i = end;
        continue;
      }
    }

    // Colon named parameter :param
    if (ch === ":" && next !== undefined && isIdentStart(next) && (i === 0 || !isIdentPart(sql[i - 1]!))) {
      let end = i + 2;
      while (end < sql.length && isIdentPart(sql[end]!)) {
        end += 1;
      }
      const name = sql.slice(i + 1, end);
      out += onParam(name, ":");
      i = end;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function isQueryBuilder(input: object): input is SqlQueryBuilder {
  return "toSQL" in input && typeof (input as { toSQL?: unknown }).toSQL === "function";
}

function isReyloSqlModule(input: object): input is ReyloQueryModule {
  if ("sql" in input && typeof (input as { sql?: unknown }).sql === "string") {
    return true;
  }
  if ("raw" in input && typeof (input as { raw?: unknown }).raw === "string") {
    return true;
  }
  return false;
}

/**
 * Extracts raw SQL text and embedded parameters from a SQL string, Reylo `.sql` module,
 * or Drizzle / Kysely / Knex `.toSQL()` builder without rewriting parameters yet.
 */
export function extractRawQuery(query: QueryInput): {
  rawSql: string;
  embeddedParams: readonly unknown[] | undefined;
} {
  if (typeof query === "string") {
    return { rawSql: query, embeddedParams: undefined };
  }

  if (query !== null && typeof query === "object") {
    if (isQueryBuilder(query)) {
      const built = query.toSQL();
      if (!built || typeof built.sql !== "string") {
        throw new TypeError("Query builder .toSQL() must return an object with a string `sql` property.");
      }
      const embeddedParams = Array.isArray(built.params)
        ? built.params
        : Array.isArray(built.bindings)
          ? built.bindings
          : undefined;
      return { rawSql: built.sql, embeddedParams };
    }

    if (isReyloSqlModule(query)) {
      const rawSql = "sql" in query ? query.sql : query.raw;
      const embeddedParams = Array.isArray(query.params) ? query.params : undefined;
      return { rawSql, embeddedParams };
    }
  }

  throw new TypeError(
    "Unsupported query input: expected a SQL string, a Reylo { sql } / { raw } module, or a query builder with .toSQL().",
  );
}

/**
 * Normalizes any supported `QueryInput` and optional `QueryParams` into a validated single-statement
 * SQL string and positional parameter array for the target placeholder style.
 */
export function normalizeQuery(
  query: QueryInput,
  params?: QueryParams,
  style: ParameterStyle = "dollar",
): NormalizedQuery {
  const { rawSql, embeddedParams } = extractRawQuery(query);
  const cleanSql = validateSingleStatementSql(rawSql);

  if (params !== undefined) {
    if (Array.isArray(params)) {
      return { sql: cleanSql, params: [...params] };
    }
    return bindNamedParams(cleanSql, params as Readonly<Record<string, unknown>>, style);
  }

  return {
    sql: cleanSql,
    params: embeddedParams ? [...embeddedParams] : [],
  };
}
