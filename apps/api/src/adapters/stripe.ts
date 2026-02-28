import type { ProviderAdapter, UsageInfo } from './types.js'
import { filterSafeHeaders } from './utils.js'

export const stripeAdapter: ProviderAdapter = {
  id: 'stripe',
  name: 'Stripe',
  category: 'payments',
  baseUrl: 'https://api.stripe.com',
  description: 'Payment processing, subscriptions, invoicing, and financial infrastructure',
  docsUrl: 'https://stripe.com/docs/api',
  authPattern: { type: 'bearer' },
  contentType: 'application/x-www-form-urlencoded',

  buildOutboundHeaders(inbound, apiKey) {
    const headers = filterSafeHeaders(inbound)
    headers['authorization'] = `Bearer ${apiKey}`
    return headers
  },

  extractUsage(_method, _path, _reqBody, status, resBody): UsageInfo | null {
    if (status >= 400) return null
    const body = resBody as Record<string, unknown>
    // stripe charges: 2.9% + 30¢ per successful charge
    if (body?.object === 'charge' && body?.amount) {
      const amount = body.amount as number
      const fee = Math.round(amount * 0.029 + 30)
      return {
        costCents: fee,
        units: { amount_cents: amount },
        costDescription: `stripe fee on ${amount}¢ charge`
      }
    }
    // API call cost is effectively 0 for non-charge endpoints
    return { costCents: 0, costDescription: 'no direct cost' }
  },

  validateKeyFormat(key) {
    return (key.startsWith('sk_test_') || key.startsWith('sk_live_')) && key.length > 20
  },

  blockedPatterns: [
    /^DELETE \/v1\/accounts/  // prevent account deletion via proxy
  ]
}
