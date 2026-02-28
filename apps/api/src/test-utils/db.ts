/**
 * @internal Test helper — creates an isolated in-memory SQLite database
 * with the full schema but WITHOUT the runtime normalization migration.
 * Use this when you need to insert "bad" data before testing migration logic.
 */
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(__dirname, '..', 'db', 'schema.sql')

export function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const schema = readFileSync(schemaPath, 'utf-8')
  db.exec(schema)

  // Apply structural migrations (same as client.ts) but NOT data normalization
  const migrations = [
    `ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`,
    `ALTER TABLE playbook_executions ADD COLUMN settlement_status TEXT NOT NULL DEFAULT 'pending'`,
  ]
  for (const m of migrations) {
    try { db.exec(m) } catch { /* column already exists */ }
  }

  return db
}
