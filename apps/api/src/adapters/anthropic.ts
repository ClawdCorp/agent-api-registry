import type { ProviderAdapter, UsageInfo } from './types.js'
import { filterSafeHeaders } from './utils.js'
import { calculateCostCents } from '../core/pricing.js'

export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  name: 'Anthropic',
  category: 'ai',
  baseUrl: 'https://api.anthropic.com',
  description: 'Claude models for text generation, analysis, and tool use',
  docsUrl: 'https://docs.anthropic.com',
  authPattern: { type: 'header', headerName: 'x-api-key' },

  buildOutboundHeaders(inbound, apiKey) {
    const headers = filterSafeHeaders(inbound)
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01'
    return headers
  },

  extractUsage(_method, _path, _reqBody, status, resBody): UsageInfo | null {
    if (status >= 400) return null
    const body = resBody as Record<string, unknown>
    const usage = body?.usage as Record<string, number> | undefined
    if (usage) {
      const inputTokens = usage.input_tokens ?? 0
      const outputTokens = usage.output_tokens ?? 0
      const costCents = calculateCostCents('anthropic', {
        input_token: inputTokens,
        output_token: outputTokens,
      })
      return {
        costCents,
        units: { input_tokens: inputTokens, output_tokens: outputTokens },
        costDescription: `${inputTokens} in / ${outputTokens} out tokens`
      }
    }
    return { costCents: 0, costDescription: 'usage not extracted' }
  },

  validateKeyFormat(key) {
    return key.startsWith('sk-ant-') && key.length > 20
  }
}
