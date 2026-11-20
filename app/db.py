import sqlite3
from pathlib import Path

from flask import current_app, g

SCHEMA = """
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
"""


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(app):
    Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(app.config["DATABASE"])
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
    app.teardown_appcontext(close_db)
