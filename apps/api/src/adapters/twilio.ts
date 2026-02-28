import type { ProviderAdapter, UsageInfo } from './types.js'
import { filterSafeHeaders } from './utils.js'
import { calculateCostCents } from '../core/pricing.js'

export const twilioAdapter: ProviderAdapter = {
  id: 'twilio',
  name: 'Twilio',
  category: 'communications',
  baseUrl: 'https://api.twilio.com',
  description: 'SMS, voice calls, video, and messaging APIs',
  docsUrl: 'https://www.twilio.com/docs',
  authPattern: { type: 'basic' },

  buildOutboundHeaders(inbound, apiKey) {
    const headers = filterSafeHeaders(inbound)
    // Twilio uses Basic auth: base64(accountSid:authToken)
    // The stored key should be "accountSid:authToken"
    headers['authorization'] = `Basic ${Buffer.from(apiKey).toString('base64')}`
    return headers
  },

  extractUsage(method, path, _reqBody, status, _resBody): UsageInfo | null {
    if (status >= 400) return null
    if (method === 'POST' && path.includes('/Messages')) {
      const costCents = calculateCostCents('twilio', { sms_sent: 1 })
      return {
        costCents,
        units: { messages_sent: 1 },
        costDescription: '1 SMS sent'
      }
    }
    return { costCents: 0, costDescription: 'no direct cost' }
  },

  validateKeyFormat(key) {
    // expects "ACxxxxxxx:authtoken" format
    return key.includes(':') && key.startsWith('AC')
  }
}
