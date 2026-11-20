import "server-only";
import Database from "better-sqlite3";
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

// One connection per process (better-sqlite3 is synchronous). Cached on globalThis so
// Next's dev-mode hot reload doesn't open a new handle on every edit.
const g = globalThis as unknown as { __resumeDb?: { path: string; db: Database.Database } };

export function getDb(): Database.Database {
  const file = config().databasePath;
  if (g.__resumeDb && g.__resumeDb.path === file) return g.__resumeDb.db;
  g.__resumeDb?.db.close();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  g.__resumeDb = { path: file, db };
  return db;
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
