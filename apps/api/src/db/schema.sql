-- Agent API Registry — SQLite schema (Phase 0)

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  monthly_budget_cents INTEGER NOT NULL DEFAULT 0,
  credit_balance_cents INTEGER NOT NULL DEFAULT 0,
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

-- ---------------------------------------------------------------------------
-- Phase 1: Credits, Stripe, Playbooks, Executions, Platform Provider Keys
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  type TEXT NOT NULL CHECK(type IN ('purchase', 'consumption', 'refund', 'reservation', 'release')),
  amount_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credit_txn_account ON credit_transactions(account_id, created_at);

CREATE TABLE IF NOT EXISTS stripe_customers (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES accounts(id),
  industry TEXT NOT NULL,
  input_schema TEXT NOT NULL,
  output_schema TEXT NOT NULL,
  steps TEXT NOT NULL,
  estimated_cost_cents_min INTEGER NOT NULL,
  estimated_cost_cents_max INTEGER NOT NULL,
  providers TEXT NOT NULL,
  price_cents_per_exec INTEGER NOT NULL,
  author_share_pct INTEGER NOT NULL DEFAULT 85,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'deprecated')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, version)
);
CREATE INDEX IF NOT EXISTS idx_playbooks_status ON playbooks(status);
CREATE INDEX IF NOT EXISTS idx_playbooks_author ON playbooks(author_id);

CREATE TABLE IF NOT EXISTS playbook_installs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  playbook_id TEXT NOT NULL,
  version_pinned TEXT NOT NULL,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  uninstalled_at TEXT,
  UNIQUE(account_id, playbook_id)
);
CREATE INDEX IF NOT EXISTS idx_installs_account ON playbook_installs(account_id);

CREATE TABLE IF NOT EXISTS playbook_executions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  playbook_id TEXT NOT NULL,
  playbook_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'partial')),
  input TEXT NOT NULL,
  output TEXT,
  total_cost_cents INTEGER,
  credit_txn_id TEXT REFERENCES credit_transactions(id),
  steps_completed INTEGER NOT NULL DEFAULT 0,
  steps_total INTEGER NOT NULL,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_executions_account ON playbook_executions(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_executions_status ON playbook_executions(status);

CREATE TABLE IF NOT EXISTS platform_provider_keys (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  label TEXT,
  rpm_limit INTEGER NOT NULL DEFAULT 60,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_platform_keys_provider ON platform_provider_keys(provider, active);
