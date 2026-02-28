import type { ProviderAdapter, UsageInfo } from './types.js'
import { filterSafeHeaders } from './utils.js'
import { calculateCostCents } from '../core/pricing.js'

export const resendAdapter: ProviderAdapter = {
  id: 'resend',
  name: 'Resend',
  category: 'email',
  baseUrl: 'https://api.resend.com',
  description: 'Transactional and marketing email sending API',
  docsUrl: 'https://resend.com/docs',
  authPattern: { type: 'bearer' },

  buildOutboundHeaders(inbound, apiKey) {
    const headers = filterSafeHeaders(inbound)
    headers['authorization'] = `Bearer ${apiKey}`
    return headers
  },

  extractUsage(method, path, _reqBody, status, _resBody): UsageInfo | null {
    if (status >= 400) return null
    if (method === 'POST' && path.startsWith('/emails')) {
      const costCents = calculateCostCents('resend', { email_sent: 1 })
      return {
        costCents,
        units: { emails_sent: 1 },
        costDescription: '1 email sent'
      }
    }
    return { costCents: 0, costDescription: 'no direct cost' }
  },

  validateKeyFormat(key) {
    return key.startsWith('re_') && key.length > 10
  }
}
