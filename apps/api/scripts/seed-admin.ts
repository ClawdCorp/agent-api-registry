import { randomUUID, randomBytes, createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

const ADMIN_EMAIL = 'admin@aar.dev'

export type SeedAdminResult =
  | { created: true; adminId: string; email: string; apiKey: string }
  | { created: false; adminId: string }

/**
 * Create an admin account if one with the admin email doesn't already exist.
 * If the email is already taken (even by a non-admin), no changes are made.
 * This is the Bug #73 safety behavior — never auto-promote by email.
 */
export function seedAdminAccount(db: Database.Database): SeedAdminResult {
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

    return { created: true, adminId, email: ADMIN_EMAIL, apiKey }
  }

  return { created: false, adminId: existing.id }
}
