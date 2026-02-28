import { randomUUID } from 'node:crypto'
import { getDb } from '../db/client.js'

export interface SpendEvent {
  id: string
  accountId: string
  provider: string
  method: string
  endpoint: string
  costCents: number
  responseStatus: number | null
  latencyMs: number | null
  createdAt: string
}

function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function logSpendEvent(event: Omit<SpendEvent, 'id' | 'createdAt'>): SpendEvent {
  const db = getDb()
  const id = `se_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const createdAt = new Date().toISOString()
  const yearMonth = currentYearMonth()

  const insertEvent = db.prepare(`
    INSERT INTO spend_events (id, account_id, provider, method, endpoint, cost_cents, response_status, latency_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const upsertMonthly = db.prepare(`
    INSERT INTO account_spend_monthly (account_id, year_month, total_cents)
    VALUES (?, ?, ?)
    ON CONFLICT(account_id, year_month)
    DO UPDATE SET total_cents = total_cents + excluded.total_cents
  `)

  const txn = db.transaction(() => {
    insertEvent.run(id, event.accountId, event.provider, event.method, event.endpoint, event.costCents, event.responseStatus, event.latencyMs, createdAt)
    upsertMonthly.run(event.accountId, yearMonth, event.costCents)
  })

  txn()

  return { id, createdAt, ...event }
}

export function getMonthlySpend(accountId: string): number {
  const db = getDb()
  const yearMonth = currentYearMonth()
  const row = db.prepare(
    'SELECT total_cents FROM account_spend_monthly WHERE account_id = ? AND year_month = ?'
  ).get(accountId, yearMonth) as { total_cents: number } | undefined
  return row?.total_cents ?? 0
}

export function getRecentSpendEvents(accountId: string, limit = 50): SpendEvent[] {
  const db = getDb()
  return db.prepare(
    'SELECT id, account_id as accountId, provider, method, endpoint, cost_cents as costCents, response_status as responseStatus, latency_ms as latencyMs, created_at as createdAt FROM spend_events WHERE account_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(accountId, limit) as SpendEvent[]
}
