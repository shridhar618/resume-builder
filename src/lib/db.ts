import "server-only";
import { createClient, type Client, type InValue, type ResultSet } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

// Same schema as the original Flask app, so an existing instance/resume_builder.db keeps working.
// `sessions` is new: server-side sessions replace Flask's signed-cookie sessions.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
    user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    full_name TEXT DEFAULT '',
    headline  TEXT DEFAULT '',
    email     TEXT DEFAULT '',
    phone     TEXT DEFAULT '',
    location  TEXT DEFAULT '',
    website   TEXT DEFAULT '',
    linkedin  TEXT DEFAULT '',
    github    TEXT DEFAULT '',
    summary   TEXT DEFAULT '',
    target_role TEXT DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resumes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    template   TEXT    NOT NULL DEFAULT 'modern',
    data       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf       TEXT    NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

// libSQL client: a local SQLite file in development (same file as before), or a hosted
// Turso database in production (Vercel functions can't keep files between requests).
// Cached on globalThis so Next's dev-mode hot reload doesn't open a new handle on every edit.
type Cached = { key: string; client: Client; ready: Promise<void> };
const g = globalThis as unknown as { __resumeDb?: Cached };

function open(): Cached {
  const cfg = config();
  const key = cfg.databaseUrl || `file:${cfg.databasePath}`;
  if (g.__resumeDb && g.__resumeDb.key === key) return g.__resumeDb;
  g.__resumeDb?.client.close();
  let client: Client;
  let ready: Promise<void>;
  if (cfg.databaseUrl) {
    client = createClient({ url: cfg.databaseUrl, authToken: cfg.databaseAuthToken || undefined });
    ready = client.executeMultiple(SCHEMA);
  } else {
    fs.mkdirSync(path.dirname(cfg.databasePath), { recursive: true });
    client = createClient({ url: key });
    ready = client.executeMultiple(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; ${SCHEMA}`);
  }
  // If creating the schema fails (e.g. bad credentials), retry on the next request.
  ready = ready.catch((e) => {
    if (g.__resumeDb?.client === client) g.__resumeDb = undefined;
    throw e;
  });
  g.__resumeDb = { key, client, ready };
  return g.__resumeDb;
}

/** The database client, with the schema created. */
export async function getDb(): Promise<Client> {
  const c = open();
  await c.ready;
  return c.client;
}

export type Stmt = { sql: string; args?: InValue[] };

function toObjects<T>(rs: ResultSet): T[] {
  return rs.rows.map((row) => Object.fromEntries(rs.columns.map((col, i) => [col, row[i]])) as T);
}

/** First matching row, or null. */
export async function one<T>(sql: string, args: InValue[] = []): Promise<T | null> {
  return toObjects<T>(await (await getDb()).execute({ sql, args }))[0] ?? null;
}

/** All matching rows. */
export async function all<T>(sql: string, args: InValue[] = []): Promise<T[]> {
  return toObjects<T>(await (await getDb()).execute({ sql, args }));
}

/** Run a write. Returns rows changed and the new row id (for INSERTs). */
export async function run(sql: string, args: InValue[] = []): Promise<{ changes: number; lastId: number }> {
  const rs = await (await getDb()).execute({ sql, args });
  return { changes: rs.rowsAffected, lastId: Number(rs.lastInsertRowid ?? 0) };
}

/** Run several writes in one transaction (all succeed or none do). */
export async function batch(stmts: Stmt[]): Promise<ResultSet[]> {
  return (await getDb()).batch(stmts.map((s) => ({ sql: s.sql, args: s.args ?? [] })), "write");
}

export type UserRow = { id: number; email: string; name: string };
export type ProfileRow = {
  user_id: number;
  full_name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  linkedin: string;
  github: string;
  summary: string;
  target_role: string;
};
export type ResumeRow = {
  id: number;
  user_id: number;
  title: string;
  template: string;
  data: string;
  created_at: string;
  updated_at: string;
};
