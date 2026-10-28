/**
 * Runs one read-only query for the run_sql tool, in its own process so a
 * runaway query can be killed (SQLite queries can't be interrupted from JS).
 *
 *   node sql-runner.ts <db file>     (reads {sql, maxRows} as JSON on stdin)
 *
 * Prints {columns, rows, truncated} or {error} as JSON. Three guards keep it
 * read-only: the connection is read-only with query_only on, the query is
 * wrapped as a subquery (so only SELECT or WITH … SELECT parses), and the
 * statement must return rows.
 */

import { readFileSync } from "node:fs";

import Database from "better-sqlite3";

/** Longest string returned per cell (raw_json payloads run to ~16 KB). */
const MAX_TEXT = 500;

function cell(v: unknown) {
  if (typeof v === "string" && v.length > MAX_TEXT) return `${v.slice(0, MAX_TEXT)}… (${v.length} chars)`;
  if (Buffer.isBuffer(v)) return `(blob, ${v.length} bytes)`;
  if (typeof v === "bigint") return Number(v);
  return v;
}

function run(file: string, sql: string, maxRows: number) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  const body = sql.trim().replace(/;+\s*$/, "");
  // the newline before ")" ends any trailing -- comment
  const stmt = db.prepare(`SELECT * FROM (\n${body}\n) LIMIT ${maxRows + 1}`);
  if (!stmt.reader) throw new Error("Only queries that return rows are allowed.");
  const rows = (stmt.raw(true).all() as unknown[][]).map((r) => r.map(cell));
  return {
    columns: stmt.columns().map((c) => c.name),
    rows: rows.slice(0, maxRows),
    truncated: rows.length > maxRows,
  };
}

const { sql, maxRows } = JSON.parse(readFileSync(0, "utf8")) as { sql: string; maxRows: number };
let out: unknown;
try {
  out = run(process.argv[2], sql, maxRows);
} catch (e) {
  const msg = (e as Error).message;
  // writes, PRAGMAs and second statements fail to parse inside the wrapper
  out = { error: /syntax error/.test(msg) ? `${msg}. run_sql accepts one SELECT or WITH … SELECT statement.` : msg };
}
process.stdout.write(JSON.stringify(out));
