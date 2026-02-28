import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDb, resetDb } from '../../db/client.js'
import {
  purchaseCredits,
  reserveCredits,
  consumeCredits,
  releaseReservation,
  getBalance,
  getTransactionHistory,
} from '../credits.js'

// ── Helpers ─────────────────────────────────────────────────────────

function createAccount(id: string, balance = 0): void {
  const db = getDb()
  db.prepare(
    "INSERT INTO accounts (id, email, name, credit_balance_cents) VALUES (?, ?, ?, ?)"
  ).run(id, `${id}@test.com`, id, balance)
}

// ── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  resetDb()
  process.env.AAR_DB_PATH = ':memory:'
  delete process.env.ADMIN_ACCOUNT_ID
})

afterEach(() => {
  resetDb()
})

// ── Bug: purchaseCredits must reject non-numeric amount_cents ───────

describe('purchaseCredits — type validation', () => {
  it('throws on string amount', () => {
    getDb()
    createAccount('acct_1')
    expect(() => purchaseCredits('acct_1', 'abc' as unknown as number)).toThrow(
      'Amount must be a positive integer'
    )
  })

  it('throws on float amount', () => {
    getDb()
    createAccount('acct_1')
    expect(() => purchaseCredits('acct_1', 99.5)).toThrow(
      'Amount must be a positive integer'
    )
  })

  it('throws on NaN', () => {
    getDb()
    createAccount('acct_1')
    expect(() => purchaseCredits('acct_1', NaN)).toThrow(
      'Amount must be a positive integer'
    )
  })

  it('throws on zero', () => {
    getDb()
    createAccount('acct_1')
    expect(() => purchaseCredits('acct_1', 0)).toThrow(
      'Amount must be a positive integer'
    )
  })

  it('accepts valid positive integer', () => {
    getDb()
    createAccount('acct_1')
    const txn = purchaseCredits('acct_1', 500)
    expect(txn.amountCents).toBe(500)
    expect(txn.balanceAfterCents).toBe(500)
  })
})

// ── Bug: failed execution with partial success must charge for completed steps ──

describe('credit settlement — partial success on failed execution', () => {
  it('consumeCredits charges only actual cost and refunds overage', () => {
    getDb()
    createAccount('acct_settle', 10000)

    // Reserve 1000 cents (max estimated)
    const reservation = reserveCredits('acct_settle', 1000, 'exec_1')
    expect(getBalance('acct_settle')).toBe(9000)

    // Only 300 cents of actual cost (2 of 3 steps succeeded before failure)
    consumeCredits(reservation.id, 300)

    // Should have refunded 700 of the 1000 reserved
    expect(getBalance('acct_settle')).toBe(9700)
  })

  it('releaseReservation refunds the full reserved amount', () => {
    getDb()
    createAccount('acct_release', 10000)

    const reservation = reserveCredits('acct_release', 1000, 'exec_2')
    expect(getBalance('acct_release')).toBe(9000)

    // Full release — no steps completed
    releaseReservation(reservation.id)

    expect(getBalance('acct_release')).toBe(10000)
  })

  it('consumeCredits with zero cost refunds entire reservation', () => {
    // Edge case: totalCostCents = 0 but we still call consumeCredits
    // This shouldn't happen with the new fix (we'd call releaseReservation instead),
    // but consumeCredits should handle it correctly regardless
    getDb()
    createAccount('acct_zero', 5000)

    const reservation = reserveCredits('acct_zero', 500, 'exec_3')
    expect(getBalance('acct_zero')).toBe(4500)

    consumeCredits(reservation.id, 0)

    // Full refund via release difference
    expect(getBalance('acct_zero')).toBe(5000)
  })
})

// ── Bug: getTransactionHistory with bad limit values ────────────────

describe('getTransactionHistory — limit handling', () => {
  it('returns results with valid limit', () => {
    getDb()
    createAccount('acct_hist', 0)
    purchaseCredits('acct_hist', 100)
    purchaseCredits('acct_hist', 200)

    const txns = getTransactionHistory('acct_hist', 1)
    expect(txns).toHaveLength(1)
  })

  it('returns all results with default limit', () => {
    getDb()
    createAccount('acct_hist2', 0)
    purchaseCredits('acct_hist2', 100)
    purchaseCredits('acct_hist2', 200)

    const txns = getTransactionHistory('acct_hist2')
    expect(txns).toHaveLength(2)
  })
})

// ── Bug: reserveCredits must also reject non-numeric amount ─────────

describe('reserveCredits — type validation', () => {
  it('throws on string amount', () => {
    getDb()
    createAccount('acct_res', 10000)
    expect(() =>
      reserveCredits('acct_res', 'abc' as unknown as number, 'exec_x')
    ).toThrow('Amount must be a positive integer')
  })

  it('throws on float amount', () => {
    getDb()
    createAccount('acct_res2', 10000)
    expect(() => reserveCredits('acct_res2', 50.5, 'exec_y')).toThrow(
      'Amount must be a positive integer'
    )
  })
})
