import { getDb } from '../db/client.js'
import { getMonthlySpend } from './spend.js'

export interface BudgetStatus {
  spentCents: number
  limitCents: number
  remainingCents: number
  utilizationPct: number
  blocked: boolean
}

export function checkBudget(accountId: string): BudgetStatus {
  const db = getDb()
  const account = db.prepare(
    'SELECT monthly_budget_cents FROM accounts WHERE id = ?'
  ).get(accountId) as { monthly_budget_cents: number } | undefined

  const limitCents = account?.monthly_budget_cents ?? 0
  const spentCents = getMonthlySpend(accountId)

  // 0 means unlimited
  if (limitCents === 0) {
    return {
      spentCents,
      limitCents: 0,
      remainingCents: Infinity,
      utilizationPct: 0,
      blocked: false
    }
  }

  const remainingCents = Math.max(0, limitCents - spentCents)
  const utilizationPct = Math.round((spentCents / limitCents) * 100)

  return {
    spentCents,
    limitCents,
    remainingCents,
    utilizationPct,
    blocked: spentCents >= limitCents
  }
}

export function checkAndAlertThresholds(accountId: string): number[] {
  const { utilizationPct, limitCents } = checkBudget(accountId)
  if (limitCents === 0) return []

  const db = getDb()
  const now = new Date()
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const crossedThresholds: number[] = []

  for (const threshold of [50, 80, 95]) {
    if (utilizationPct >= threshold) {
      const existing = db.prepare(
        'SELECT 1 FROM budget_alerts WHERE account_id = ? AND year_month = ? AND threshold = ?'
      ).get(accountId, yearMonth, threshold)

      if (!existing) {
        db.prepare(
          'INSERT INTO budget_alerts (account_id, year_month, threshold) VALUES (?, ?, ?)'
        ).run(accountId, yearMonth, threshold)
        crossedThresholds.push(threshold)
      }
    }
  }

  return crossedThresholds
}
