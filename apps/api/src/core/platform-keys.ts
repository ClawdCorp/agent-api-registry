import { getDb } from '../db/client.js'
import { decrypt } from './crypto.js'

interface PlatformKeyRow {
  id: string
  provider: string
  encrypted_key: string
  iv: string
  rpm_limit: number
  label: string | null
  active: number
  created_at: string
}

// In-memory RPM tracking per key
const rpmCounters = new Map<string, { count: number; resetAt: number }>()

function getRpmCounter(keyId: string): { count: number; resetAt: number } {
  const now = Date.now()
  const existing = rpmCounters.get(keyId)
  if (existing && existing.resetAt > now) {
    return existing
  }
  // reset or create
  const counter = { count: 0, resetAt: now + 60_000 }
  rpmCounters.set(keyId, counter)
  return counter
}

/**
 * Get the least-loaded active platform key for a provider.
 * Tracks RPM in-memory and resets every 60 seconds.
 */
export function selectPlatformKey(provider: string): { keyId: string; apiKey: string } {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM platform_provider_keys WHERE provider = ? AND active = 1'
  ).all(provider) as PlatformKeyRow[]

  if (rows.length === 0) {
    throw new PlatformKeyError(
      `no active platform keys for provider: ${provider}`,
      'no_platform_key',
      400,
    )
  }

  // Filter out rows with invalid rpm_limit (legacy bad data)
  const validRows = rows.filter((row) => row.rpm_limit > 0)
  if (validRows.length === 0) {
    throw new PlatformKeyError(
      `no valid platform keys for provider: ${provider} (${rows.length} key(s) have invalid rpm_limit)`,
      'no_platform_key',
      400,
    )
  }

  // Find the key with lowest utilization (currentRpm / rpmLimit)
  let bestRow: PlatformKeyRow | null = null
  let bestRatio = Infinity

  for (const row of validRows) {
    const counter = getRpmCounter(row.id)
    const ratio = counter.count / row.rpm_limit
    if (ratio < bestRatio) {
      bestRatio = ratio
      bestRow = row
    }
  }

  if (!bestRow) {
    throw new PlatformKeyError(
      `no valid platform keys for provider: ${provider}`,
      'no_platform_key',
      400,
    )
  }

  // Check if the best key is at capacity
  const bestCounter = getRpmCounter(bestRow.id)
  if (bestCounter.count >= bestRow.rpm_limit) {
    throw new PlatformKeyError(
      `all platform keys for ${provider} are at RPM capacity`,
      'rate_limited',
      429,
    )
  }

  // Pre-increment counter to prevent concurrent over-assignment
  bestCounter.count++

  const apiKey = decrypt(bestRow.encrypted_key, bestRow.iv)
  return { keyId: bestRow.id, apiKey }
}

/**
 * Increment the RPM counter for a key (call after successful use).
 */
export function recordKeyUsage(keyId: string): void {
  const counter = getRpmCounter(keyId)
  counter.count++
}

/**
 * Decrement the RPM counter for a key (call on failed outbound calls to release reservation).
 */
export function releaseKeyUsage(keyId: string): void {
  const counter = rpmCounters.get(keyId)
  if (counter && counter.count > 0) {
    counter.count--
  }
}

/**
 * Get all platform keys for admin view (don't expose the actual keys).
 */
export function listPlatformKeys(provider?: string): Array<{
  id: string
  provider: string
  label: string | null
  rpmLimit: number
  active: boolean
  currentRpm: number
  createdAt: string
}> {
  const db = getDb()
  let rows: PlatformKeyRow[]
  if (provider) {
    rows = db.prepare(
      'SELECT * FROM platform_provider_keys WHERE provider = ? ORDER BY created_at DESC'
    ).all(provider) as PlatformKeyRow[]
  } else {
    rows = db.prepare(
      'SELECT * FROM platform_provider_keys ORDER BY created_at DESC'
    ).all() as PlatformKeyRow[]
  }

  return rows.map((row) => {
    const counter = getRpmCounter(row.id)
    return {
      id: row.id,
      provider: row.provider,
      label: row.label,
      rpmLimit: row.rpm_limit,
      active: row.active === 1,
      currentRpm: counter.count,
      createdAt: row.created_at,
    }
  })
}

export class PlatformKeyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'PlatformKeyError'
  }
}
