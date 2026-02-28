import { getDb } from '../db/client.js'

// In-memory RPM tracking per account (mirrors platform-keys.ts pattern)
const accountRpmCounters = new Map<string, { count: number; resetAt: number }>()

function getCounter(accountId: string): { count: number; resetAt: number } {
  const now = Date.now()
  const existing = accountRpmCounters.get(accountId)
  if (existing && existing.resetAt > now) return existing
  const counter = { count: 0, resetAt: now + 60_000 }
  accountRpmCounters.set(accountId, counter)
  return counter
}

/** Check if account is within RPM limit. Pre-increments on success. */
export function checkAccountRpm(accountId: string): { allowed: boolean; current: number; limit: number } {
  const db = getDb()
  const row = db.prepare('SELECT rpm_limit FROM accounts WHERE id = ?').get(accountId) as { rpm_limit: number } | undefined
  const limit = row?.rpm_limit ?? 60
  if (limit === 0) return { allowed: true, current: 0, limit: 0 } // 0 = unlimited

  const counter = getCounter(accountId)
  if (counter.count >= limit) return { allowed: false, current: counter.count, limit }
  counter.count++
  return { allowed: true, current: counter.count, limit }
}

/** Release a pre-incremented RPM reservation (on failed calls). */
export function releaseAccountRpm(accountId: string): void {
  const counter = accountRpmCounters.get(accountId)
  if (counter && counter.count > 0) counter.count--
}
