import { randomUUID } from 'node:crypto'
import { getDb } from '../db/client.js'

export interface CreditTransaction {
  id: string
  accountId: string
  type: 'purchase' | 'consumption' | 'refund' | 'reservation' | 'release'
  amountCents: number
  balanceAfterCents: number
  referenceType: string | null
  referenceId: string | null
  description: string | null
  createdAt: string
}

function generateId(): string {
  return `ct_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

function getCurrentBalance(db: ReturnType<typeof getDb>, accountId: string): number {
  const row = db.prepare(
    'SELECT credit_balance_cents FROM accounts WHERE id = ?'
  ).get(accountId) as { credit_balance_cents: number } | undefined
  if (row === undefined) {
    throw new Error(`Account not found: ${accountId}`)
  }
  return row.credit_balance_cents
}

function insertTransaction(
  db: ReturnType<typeof getDb>,
  txn: {
    id: string
    accountId: string
    type: string
    amountCents: number
    balanceAfterCents: number
    referenceType: string | null
    referenceId: string | null
    description: string | null
    createdAt: string
  }
): void {
  db.prepare(`
    INSERT INTO credit_transactions (id, account_id, type, amount_cents, balance_after_cents, reference_type, reference_id, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    txn.id,
    txn.accountId,
    txn.type,
    txn.amountCents,
    txn.balanceAfterCents,
    txn.referenceType,
    txn.referenceId,
    txn.description,
    txn.createdAt
  )
}

function updateAccountBalance(db: ReturnType<typeof getDb>, accountId: string, newBalance: number): void {
  db.prepare(
    'UPDATE accounts SET credit_balance_cents = ? WHERE id = ?'
  ).run(newBalance, accountId)
}

/**
 * Add credits to an account (from Stripe purchase or admin grant).
 * Returns the new transaction and updated balance.
 */
export function purchaseCredits(
  accountId: string,
  amountCents: number,
  options?: { referenceType?: string; referenceId?: string; description?: string }
): CreditTransaction {
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Amount must be a positive integer')
  }

  const db = getDb()
  const id = generateId()
  const createdAt = new Date().toISOString()

  let result!: CreditTransaction

  const txn = db.transaction(() => {
    const currentBalance = getCurrentBalance(db, accountId)
    const newBalance = currentBalance + amountCents

    const record = {
      id,
      accountId,
      type: 'purchase' as const,
      amountCents,
      balanceAfterCents: newBalance,
      referenceType: options?.referenceType ?? null,
      referenceId: options?.referenceId ?? null,
      description: options?.description ?? null,
      createdAt,
    }

    insertTransaction(db, record)
    updateAccountBalance(db, accountId, newBalance)

    result = record
  })

  txn()
  return result
}

/**
 * Reserve credits before playbook execution.
 * Returns the reservation transaction (needed to consume/release later).
 * Throws if insufficient balance.
 */
export function reserveCredits(
  accountId: string,
  amountCents: number,
  executionId: string
): CreditTransaction {
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Amount must be a positive integer')
  }

  const db = getDb()
  const id = generateId()
  const createdAt = new Date().toISOString()

  let result!: CreditTransaction

  const txn = db.transaction(() => {
    const currentBalance = getCurrentBalance(db, accountId)
    if (currentBalance < amountCents) {
      throw new Error('Insufficient credit balance')
    }

    const newBalance = currentBalance - amountCents

    const record = {
      id,
      accountId,
      type: 'reservation' as const,
      amountCents: -amountCents,
      balanceAfterCents: newBalance,
      referenceType: 'playbook_execution',
      referenceId: executionId,
      description: null,
      createdAt,
    }

    insertTransaction(db, record)
    updateAccountBalance(db, accountId, newBalance)

    result = record
  })

  txn()
  return result
}

/**
 * Finalize a reservation after successful execution.
 * If actual cost < reserved, releases the difference.
 * Updates the reservation type to 'consumption'.
 */
export function consumeCredits(
  reservationTxnId: string,
  actualCostCents: number
): CreditTransaction {
  if (actualCostCents < 0) {
    throw new Error('Actual cost must be non-negative')
  }

  const db = getDb()

  let result!: CreditTransaction

  const txn = db.transaction(() => {
    const reservation = db.prepare(
      'SELECT id, account_id, type, amount_cents, balance_after_cents, reference_type, reference_id, description, created_at FROM credit_transactions WHERE id = ?'
    ).get(reservationTxnId) as {
      id: string
      account_id: string
      type: string
      amount_cents: number
      balance_after_cents: number
      reference_type: string | null
      reference_id: string | null
      description: string | null
      created_at: string
    } | undefined

    if (!reservation) {
      throw new Error(`Reservation not found: ${reservationTxnId}`)
    }
    if (reservation.type !== 'reservation') {
      throw new Error(`Transaction ${reservationTxnId} is not a reservation (type: ${reservation.type})`)
    }

    const reservedAmount = Math.abs(reservation.amount_cents)

    if (actualCostCents > reservedAmount) {
      throw new Error(`Actual cost (${actualCostCents}) exceeds reserved amount (${reservedAmount})`)
    }

    // Update the reservation to a consumption
    db.prepare(
      'UPDATE credit_transactions SET type = ?, amount_cents = ? WHERE id = ?'
    ).run('consumption', -actualCostCents, reservationTxnId)

    if (actualCostCents < reservedAmount) {
      // Release the difference back to the account
      const difference = reservedAmount - actualCostCents
      const currentBalance = getCurrentBalance(db, reservation.account_id)
      const newBalance = currentBalance + difference

      const releaseId = generateId()
      const releaseCreatedAt = new Date().toISOString()

      insertTransaction(db, {
        id: releaseId,
        accountId: reservation.account_id,
        type: 'release',
        amountCents: difference,
        balanceAfterCents: newBalance,
        referenceType: 'reservation',
        referenceId: reservationTxnId,
        description: null,
        createdAt: releaseCreatedAt,
      })

      updateAccountBalance(db, reservation.account_id, newBalance)

      // Update the consumption record's balance_after_cents to reflect
      // that only actualCostCents was consumed (balance was already lowered by reservedAmount,
      // but now we're releasing some back — the consumption balance_after stays as-is since
      // the release transaction captures the balance change)
    }

    // Re-read the updated consumption transaction
    const updated = db.prepare(
      `SELECT id, account_id as accountId, type, amount_cents as amountCents,
              balance_after_cents as balanceAfterCents, reference_type as referenceType,
              reference_id as referenceId, description, created_at as createdAt
       FROM credit_transactions WHERE id = ?`
    ).get(reservationTxnId) as CreditTransaction

    result = updated
  })

  txn()
  return result
}

/**
 * Cancel a reservation (execution failed).
 * Restores the full reserved amount to the account balance.
 */
export function releaseReservation(reservationTxnId: string): CreditTransaction {
  const db = getDb()

  let result!: CreditTransaction

  const txn = db.transaction(() => {
    const reservation = db.prepare(
      'SELECT id, account_id, type, amount_cents FROM credit_transactions WHERE id = ?'
    ).get(reservationTxnId) as {
      id: string
      account_id: string
      type: string
      amount_cents: number
    } | undefined

    if (!reservation) {
      throw new Error(`Reservation not found: ${reservationTxnId}`)
    }
    if (reservation.type !== 'reservation') {
      throw new Error(`Transaction ${reservationTxnId} is not a reservation (type: ${reservation.type})`)
    }

    // Idempotency guard: if we already released this reservation, return existing
    const existingRelease = db.prepare(
      "SELECT id FROM credit_transactions WHERE type = 'release' AND reference_type = 'reservation' AND reference_id = ?"
    ).get(reservationTxnId) as { id: string } | undefined

    if (existingRelease) {
      const existing = db.prepare(
        `SELECT id, account_id as accountId, type, amount_cents as amountCents,
                balance_after_cents as balanceAfterCents, reference_type as referenceType,
                reference_id as referenceId, description, created_at as createdAt
         FROM credit_transactions WHERE id = ?`
      ).get(existingRelease.id) as CreditTransaction
      result = existing
      return
    }

    const reservedAmount = Math.abs(reservation.amount_cents)
    const currentBalance = getCurrentBalance(db, reservation.account_id)
    const newBalance = currentBalance + reservedAmount

    const releaseId = generateId()
    const createdAt = new Date().toISOString()

    const record: CreditTransaction = {
      id: releaseId,
      accountId: reservation.account_id,
      type: 'release',
      amountCents: reservedAmount,
      balanceAfterCents: newBalance,
      referenceType: 'reservation',
      referenceId: reservationTxnId,
      description: null,
      createdAt,
    }

    insertTransaction(db, record)
    updateAccountBalance(db, reservation.account_id, newBalance)

    result = record
  })

  txn()
  return result
}

/**
 * Get current credit balance for an account.
 */
export function getBalance(accountId: string): number {
  const db = getDb()
  return getCurrentBalance(db, accountId)
}

/**
 * Get recent credit transactions for an account.
 */
export function getTransactionHistory(
  accountId: string,
  limit = 50
): CreditTransaction[] {
  const db = getDb()
  return db.prepare(
    `SELECT id, account_id as accountId, type, amount_cents as amountCents,
            balance_after_cents as balanceAfterCents, reference_type as referenceType,
            reference_id as referenceId, description, created_at as createdAt
     FROM credit_transactions
     WHERE account_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(accountId, limit) as CreditTransaction[]
}
