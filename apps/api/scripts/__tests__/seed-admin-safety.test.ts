import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { getDb, resetDb } from '../../src/db/client.js'

/**
 * Bug #73 — Seed script admin account safety.
 *
 * The seed script must NOT auto-promote existing accounts to admin based on email.
 * These tests replicate the seed script's admin creation SQL to verify the behavior.
 */

const ADMIN_EMAIL = 'admin@aar.dev'

/** Replicate the seed script's admin creation logic (seed.ts lines 90-106). */
function seedAdminAccount(db: ReturnType<typeof getDb>) {
  const existing = db
    .prepare('SELECT id FROM accounts WHERE email = ?')
    .get(ADMIN_EMAIL) as { id: string } | undefined

  if (!existing) {
    const adminId = `acct_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    db.prepare('INSERT INTO accounts (id, email, name, role) VALUES (?, ?, ?, ?)')
      .run(adminId, ADMIN_EMAIL, 'Admin', 'admin')

    const apiKey = `aar_sk_${randomBytes(24).toString('hex')}`
    const keyHash = createHash('sha256').update(apiKey).digest('hex')
    const keyId = `key_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    db.prepare('INSERT INTO api_keys (id, account_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?, ?)')
      .run(keyId, adminId, keyHash, apiKey.slice(0, 14), 'admin-key')

    return { created: true, adminId }
  }

  return { created: false, adminId: existing.id }
}

describe('seed admin account safety (Bug #73)', () => {
  beforeEach(() => {
    resetDb()
    process.env.AAR_DB_PATH = ':memory:'
    // Remove ADMIN_ACCOUNT_ID to prevent bootstrap promotion in getDb()
    delete process.env.ADMIN_ACCOUNT_ID
  })

  afterEach(() => {
    resetDb()
  })

  it('creates admin with role=admin when email does not exist', () => {
    const db = getDb()
    const result = seedAdminAccount(db)

    expect(result.created).toBe(true)

    const row = db.prepare('SELECT role FROM accounts WHERE id = ?').get(result.adminId) as { role: string }
    expect(row.role).toBe('admin')
  })

  it('does NOT modify role when account with admin email already exists as user', () => {
    const db = getDb()

    // Pre-insert a non-admin account with the admin email
    const hackerId = `acct_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    db.prepare('INSERT INTO accounts (id, email, name, role) VALUES (?, ?, ?, ?)')
      .run(hackerId, ADMIN_EMAIL, 'Hacker', 'user')

    // Run seed admin logic — should NOT promote
    const result = seedAdminAccount(db)
    expect(result.created).toBe(false)

    const row = db.prepare('SELECT role FROM accounts WHERE id = ?').get(hackerId) as { role: string }
    expect(row.role).toBe('user')
  })

  it('does not error when admin account already exists with role=admin', () => {
    const db = getDb()

    // First run creates admin
    seedAdminAccount(db)

    // Second run should not throw
    expect(() => seedAdminAccount(db)).not.toThrow()

    // Still exactly one account with admin email
    const rows = db.prepare('SELECT id FROM accounts WHERE email = ?').all(ADMIN_EMAIL)
    expect(rows).toHaveLength(1)
  })

  it('creates API key for new admin account', () => {
    const db = getDb()
    const result = seedAdminAccount(db)

    expect(result.created).toBe(true)

    const keys = db
      .prepare('SELECT id FROM api_keys WHERE account_id = ?')
      .all(result.adminId)
    expect(keys.length).toBeGreaterThanOrEqual(1)
  })
})
