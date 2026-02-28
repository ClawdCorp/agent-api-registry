import { listAdapters, getAdapter } from '../adapters/index.js'
import { getDb } from '../db/client.js'

export interface ProviderInfo {
  id: string
  name: string
  category: string
  description: string
  docsUrl: string
  proxyBaseUrl: string
  connected: boolean
}

export function listProviders(accountId?: string, baseUrl?: string): ProviderInfo[] {
  const proxy = baseUrl ?? process.env.AAR_PROXY_URL ?? 'http://localhost:4000'

  let connectedProviders = new Set<string>()
  if (accountId) {
    const db = getDb()
    const rows = db.prepare(
      'SELECT provider FROM provider_keys WHERE account_id = ?'
    ).all(accountId) as { provider: string }[]
    connectedProviders = new Set(rows.map(r => r.provider))
  }

  return listAdapters().map(a => ({
    id: a.id,
    name: a.name,
    category: a.category,
    description: a.description,
    docsUrl: a.docsUrl,
    proxyBaseUrl: `${proxy}/${a.id}`,
    connected: connectedProviders.has(a.id)
  }))
}

export function getProviderInfo(providerId: string, accountId?: string, baseUrl?: string): ProviderInfo | null {
  const adapter = getAdapter(providerId)
  if (!adapter) return null

  let connected = false
  if (accountId) {
    const db = getDb()
    const row = db.prepare(
      'SELECT 1 FROM provider_keys WHERE account_id = ? AND provider = ?'
    ).get(accountId, providerId)
    connected = !!row
  }

  const proxy = baseUrl ?? process.env.AAR_PROXY_URL ?? 'http://localhost:4000'
  return {
    id: adapter.id,
    name: adapter.name,
    category: adapter.category,
    description: adapter.description,
    docsUrl: adapter.docsUrl,
    proxyBaseUrl: `${proxy}/${adapter.id}`,
    connected
  }
}
