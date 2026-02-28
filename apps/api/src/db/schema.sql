-- Agent API Registry — SQLite schema (Phase 0)

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  monthly_budget_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, provider)
);

CREATE TABLE IF NOT EXISTS spend_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  provider TEXT NOT NULL,
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_spend_events_account ON spend_events(account_id, created_at);

CREATE TABLE IF NOT EXISTS account_spend_monthly (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  year_month TEXT NOT NULL,
  total_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, year_month)
);

CREATE TABLE IF NOT EXISTS budget_alerts (
  account_id TEXT NOT NULL,
  year_month TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  alerted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, year_month, threshold)
);
