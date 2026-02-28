import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    ]
    for (const m of migrations) {
      try { db.exec(m) } catch { /* column already exists */ }
    }

    // Normalize legacy invalid rpm_limit values (#74)
    db.exec(`UPDATE platform_provider_keys SET rpm_limit = 60 WHERE rpm_limit <= 0 OR rpm_limit IS NULL`)

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
