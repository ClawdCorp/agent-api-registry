import type { ProviderAdapter, UsageInfo } from './types.js'
import { filterSafeHeaders } from './utils.js'

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
      // rough gpt-4o pricing: $2.50/1M input, $10/1M output
      const costCents = Math.round((promptTokens * 0.00025 + completionTokens * 0.001) * 100)
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
