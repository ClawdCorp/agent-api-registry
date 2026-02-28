import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedDefaultPricing } from '../core/pricing.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = process.env.AAR_DB_PATH ?? join(__dirname, '..', '..', 'aar.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8')
    db.exec(schema)

    // Idempotent migrations for existing databases
    const migrations = [
      `ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`,
      `ALTER TABLE playbook_executions ADD COLUMN settlement_status TEXT NOT NULL DEFAULT 'pending'`,
      `ALTER TABLE accounts ADD COLUMN rpm_limit INTEGER NOT NULL DEFAULT 60`,
      `ALTER TABLE accounts ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE accounts ADD COLUMN verification_token TEXT`,
      `ALTER TABLE accounts ADD COLUMN verification_expires TEXT`,
      `ALTER TABLE accounts ADD COLUMN recovery_token TEXT`,
      `ALTER TABLE accounts ADD COLUMN recovery_expires TEXT`,
    ]
    for (const m of migrations) {
      try { db.exec(m) } catch { /* column already exists */ }
    }

    // Dedupe any existing duplicate (reference_type, reference_id) rows before
    // creating the unique index — keeps the earliest row per pair.
    db.exec(`
      DELETE FROM credit_transactions
      WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM credit_transactions
        WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL
        GROUP BY reference_type, reference_id
      ) AND reference_type IS NOT NULL AND reference_id IS NOT NULL
    `)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_reference ON credit_transactions(reference_type, reference_id) WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL`)

    // Normalize legacy invalid rpm_limit values (#74)
    db.exec(`UPDATE platform_provider_keys SET rpm_limit = 60 WHERE rpm_limit <= 0 OR rpm_limit IS NULL`)

    // Seed default provider pricing
    seedDefaultPricing()

    // Bootstrap admin by explicit account ID only (never by email — see #66)
    const adminId = process.env.ADMIN_ACCOUNT_ID
    if (adminId) {
      db.prepare(`UPDATE accounts SET role = 'admin' WHERE id = ? AND role = 'user'`).run(adminId)
    }
  }
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
  }
}

/** @internal Reset the DB singleton for test isolation. */
export function resetDb(): void {
  if (db) {
    db.close()
    db = undefined as unknown as Database.Database
  }
}
