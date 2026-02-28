import type { ProviderAdapter, UsageInfo } from './types.js'
import { filterSafeHeaders } from './utils.js'
import { calculateCostCents } from '../core/pricing.js'

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  name: 'OpenAI',
  category: 'ai',
  baseUrl: 'https://api.openai.com',
  description: 'GPT models, embeddings, image generation, audio, and more',
  docsUrl: 'https://platform.openai.com/docs',
  authPattern: { type: 'bearer' },

  buildOutboundHeaders(inbound, apiKey) {
    const headers = filterSafeHeaders(inbound)
    headers['authorization'] = `Bearer ${apiKey}`
    return headers
  },

  extractUsage(_method, path, _reqBody, status, resBody): UsageInfo | null {
    if (status >= 400) return null
    const body = resBody as Record<string, unknown>
    const usage = body?.usage as Record<string, number> | undefined
    if (usage) {
      const promptTokens = usage.prompt_tokens ?? 0
      const completionTokens = usage.completion_tokens ?? 0
      const costCents = calculateCostCents('openai', {
        input_token: promptTokens,
        output_token: completionTokens,
      })
      return {
        costCents,
        units: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
        costDescription: `${promptTokens} in / ${completionTokens} out tokens`
      }
    }
    // image/audio endpoints — log as zero cost (can refine later)
    return { costCents: 0, costDescription: 'usage not extracted' }
  },

  validateKeyFormat(key) {
    return key.startsWith('sk-') && key.length > 20
  }
}
