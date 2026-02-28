import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDb, resetDb } from '../../db/client.js'
import { selectPlatformKey, PlatformKeyError } from '../platform-keys.js'
import { encrypt } from '../crypto.js'
import { createTestDb } from '../../test-utils/db.js'

// ── Helpers ─────────────────────────────────────────────────────────

function insertPlatformKey(
  db: ReturnType<typeof getDb>,
  id: string,
  provider: string,
  rpmLimit: number,
  active = 1,
) {
  const { encrypted, iv } = encrypt(`test-key-${id}`)
  db.prepare(
    'INSERT INTO platform_provider_keys (id, provider, encrypted_key, iv, rpm_limit, active) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, provider, encrypted, iv, rpmLimit, active)
}

// ── selectPlatformKey — runtime guard (Bug #74) ─────────────────────

describe('selectPlatformKey — runtime guard (Bug #74)', () => {
  beforeEach(() => {
    resetDb()
    process.env.AAR_DB_PATH = ':memory:'
    delete process.env.ADMIN_ACCOUNT_ID
  })

  afterEach(() => {
    resetDb()
  })

  it('returns a valid key when all keys have valid rpm_limit', () => {
    const db = getDb()
    insertPlatformKey(db, 'pk_valid1', 'openai', 60)

    const result = selectPlatformKey('openai')
    expect(result.keyId).toBe('pk_valid1')
    expect(result.apiKey).toBe('test-key-pk_valid1')
  })

  it('skips keys with rpm_limit=0 and returns valid keys', () => {
    const db = getDb()
    insertPlatformKey(db, 'pk_bad', 'openai', 0)
    insertPlatformKey(db, 'pk_good', 'openai', 60)

    const result = selectPlatformKey('openai')
    expect(result.keyId).toBe('pk_good')
  })

  it('skips keys with rpm_limit=-1 and returns valid keys', () => {
    const db = getDb()
    insertPlatformKey(db, 'pk_neg', 'anthropic', -1)
    insertPlatformKey(db, 'pk_pos', 'anthropic', 100)

    const result = selectPlatformKey('anthropic')
    expect(result.keyId).toBe('pk_pos')
  })

  it('throws PlatformKeyError when all keys have rpm_limit <= 0', () => {
    const db = getDb()
    insertPlatformKey(db, 'pk_zero', 'stripe', 0)
    insertPlatformKey(db, 'pk_neg', 'stripe', -5)

    expect(() => selectPlatformKey('stripe')).toThrow(PlatformKeyError)
  })

  it('error message includes count of invalid keys', () => {
    const db = getDb()
    insertPlatformKey(db, 'pk_a', 'resend', 0)
    insertPlatformKey(db, 'pk_b', 'resend', -1)
    insertPlatformKey(db, 'pk_c', 'resend', -10)

    try {
      selectPlatformKey('resend')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformKeyError)
      expect((err as PlatformKeyError).message).toContain('3 key(s) have invalid rpm_limit')
    }
  })

  it('throws when no keys exist for provider', () => {
    getDb() // ensure DB initialized
    expect(() => selectPlatformKey('nonexistent')).toThrow(PlatformKeyError)
  })
})

// ── rpm_limit migration normalization (Bug #74) ─────────────────────

describe('rpm_limit migration normalization (Bug #74)', () => {
  const MIGRATION_SQL =
    'UPDATE platform_provider_keys SET rpm_limit = 60 WHERE rpm_limit <= 0 OR rpm_limit IS NULL'

  it('normalizes rpm_limit=0 to 60', () => {
    const db = createTestDb()
    db.prepare(
      'INSERT INTO platform_provider_keys (id, provider, encrypted_key, iv, rpm_limit, active) VALUES (?, ?, ?, ?, ?, 1)',
    ).run('pk_1', 'openai', 'enc', 'iv', 0)

    db.exec(MIGRATION_SQL)

    const row = db.prepare('SELECT rpm_limit FROM platform_provider_keys WHERE id = ?').get('pk_1') as { rpm_limit: number }
    expect(row.rpm_limit).toBe(60)
  })

  it('normalizes rpm_limit=-5 to 60', () => {
    const db = createTestDb()
    db.prepare(
      'INSERT INTO platform_provider_keys (id, provider, encrypted_key, iv, rpm_limit, active) VALUES (?, ?, ?, ?, ?, 1)',
    ).run('pk_2', 'openai', 'enc', 'iv', -5)

    db.exec(MIGRATION_SQL)

    const row = db.prepare('SELECT rpm_limit FROM platform_provider_keys WHERE id = ?').get('pk_2') as { rpm_limit: number }
    expect(row.rpm_limit).toBe(60)
  })

  it('normalizes rpm_limit=NULL to 60 (simulated legacy schema without NOT NULL)', () => {
    // The production schema now has NOT NULL DEFAULT 60, but legacy databases
    // may have rows with NULL from before the constraint was added.
    // Simulate by creating a table without the NOT NULL constraint.
    const db = createTestDb()
    db.exec('DROP TABLE IF EXISTS platform_provider_keys')
    db.exec(`
      CREATE TABLE platform_provider_keys (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        encrypted_key TEXT NOT NULL,
        iv TEXT NOT NULL,
        label TEXT,
        rpm_limit INTEGER DEFAULT 60,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    db.exec(
      `INSERT INTO platform_provider_keys (id, provider, encrypted_key, iv, rpm_limit, active)
       VALUES ('pk_null', 'openai', 'enc', 'iv', NULL, 1)`,
    )

    db.exec(MIGRATION_SQL)

    const row = db.prepare('SELECT rpm_limit FROM platform_provider_keys WHERE id = ?').get('pk_null') as { rpm_limit: number }
    expect(row.rpm_limit).toBe(60)
  })

  it('leaves rpm_limit=100 unchanged', () => {
    const db = createTestDb()
    db.prepare(
      'INSERT INTO platform_provider_keys (id, provider, encrypted_key, iv, rpm_limit, active) VALUES (?, ?, ?, ?, ?, 1)',
    ).run('pk_ok', 'openai', 'enc', 'iv', 100)

    db.exec(MIGRATION_SQL)

    const row = db.prepare('SELECT rpm_limit FROM platform_provider_keys WHERE id = ?').get('pk_ok') as { rpm_limit: number }
    expect(row.rpm_limit).toBe(100)
  })

  it('normalizes multiple bad rows in one pass', () => {
    const db = createTestDb()
    db.prepare(
      'INSERT INTO platform_provider_keys (id, provider, encrypted_key, iv, rpm_limit, active) VALUES (?, ?, ?, ?, ?, 1)',
    ).run('pk_a', 'openai', 'enc', 'iv', 0)
    db.prepare(
      'INSERT INTO platform_provider_keys (id, provider, encrypted_key, iv, rpm_limit, active) VALUES (?, ?, ?, ?, ?, 1)',
    ).run('pk_b', 'anthropic', 'enc', 'iv', -1)
    db.prepare(
      'INSERT INTO platform_provider_keys (id, provider, encrypted_key, iv, rpm_limit, active) VALUES (?, ?, ?, ?, ?, 1)',
    ).run('pk_c', 'stripe', 'enc', 'iv', 60)

    db.exec(MIGRATION_SQL)

    const a = db.prepare('SELECT rpm_limit FROM platform_provider_keys WHERE id = ?').get('pk_a') as { rpm_limit: number }
    const b = db.prepare('SELECT rpm_limit FROM platform_provider_keys WHERE id = ?').get('pk_b') as { rpm_limit: number }
    const c = db.prepare('SELECT rpm_limit FROM platform_provider_keys WHERE id = ?').get('pk_c') as { rpm_limit: number }
    expect(a.rpm_limit).toBe(60)
    expect(b.rpm_limit).toBe(60)
    expect(c.rpm_limit).toBe(60) // was already valid, stays the same
  })
})
