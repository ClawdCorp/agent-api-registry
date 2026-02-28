import type { ProviderAdapter } from './types.js'
import { openaiAdapter } from './openai.js'
import { anthropicAdapter } from './anthropic.js'
import { stripeAdapter } from './stripe.js'
import { resendAdapter } from './resend.js'
import { twilioAdapter } from './twilio.js'

export const adapters = new Map<string, ProviderAdapter>([
  ['openai', openaiAdapter],
  ['anthropic', anthropicAdapter],
  ['stripe', stripeAdapter],
  ['resend', resendAdapter],
  ['twilio', twilioAdapter],
])

export function getAdapter(providerId: string): ProviderAdapter | undefined {
  return adapters.get(providerId)
}

export function listAdapters(): ProviderAdapter[] {
  return Array.from(adapters.values())
}

export type { ProviderAdapter, UsageInfo } from './types.js'
