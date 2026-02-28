import { getDb } from '../db/client.js'

export interface PricingRate {
  provider: string
  operation: string
  unitCostMicrodollars: number
}

/** Get all active pricing rates for a provider. */
export function getActivePricing(provider: string): PricingRate[] {
  const db = getDb()
  return db.prepare(
    'SELECT provider, operation, unit_cost_microdollars as unitCostMicrodollars FROM provider_pricing WHERE provider = ? AND effective_to IS NULL'
  ).all(provider) as PricingRate[]
}

/**
 * Calculate cost in cents from a provider's usage units.
 * 1 cent = 10,000 microdollars.
 */
export function calculateCostCents(provider: string, units: Record<string, number>): number {
  const rates = getActivePricing(provider)
  let totalMicro = 0
  for (const rate of rates) {
    const unitCount = units[rate.operation] ?? 0
    totalMicro += unitCount * rate.unitCostMicrodollars
  }
  return Math.round(totalMicro / 10_000)
}

/** Seed default pricing rows if the table is empty. */
export function seedDefaultPricing(): void {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as c FROM provider_pricing').get() as { c: number }
  if (row.c > 0) return

  const insert = db.prepare(
    'INSERT INTO provider_pricing (provider, operation, unit_cost_microdollars) VALUES (?, ?, ?)'
  )
  // OpenAI: $2.50/1M input tokens = 2.5 microdollars/token, $10/1M output = 10 micro/token
  insert.run('openai', 'input_token', 3)    // rounded from 2.5
  insert.run('openai', 'output_token', 10)
  // Anthropic: $3/1M input = 3 micro/token, $15/1M output = 15 micro/token
  insert.run('anthropic', 'input_token', 3)
  insert.run('anthropic', 'output_token', 15)
  // Stripe fees are percentage-based (2.9% + 30¢) — computed inline in the adapter
  // Resend: $0.28/1000 emails = 280 microdollars/email
  insert.run('resend', 'email_sent', 280)
  // Twilio: $0.0079/SMS = 7900 microdollars/SMS
  insert.run('twilio', 'sms_sent', 7900)
}
