import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { listProviders, getProviderInfo } from './core/catalog.js'
import { checkBudget } from './core/budget.js'
import { getRecentSpendEvents } from './core/spend.js'
import { getDb } from './db/client.js'

// resolve account from env
const AAR_API_KEY = process.env.AAR_API_KEY
const PROXY_URL = process.env.AAR_PROXY_URL ?? 'http://localhost:4000'

function resolveAccountId(): string | undefined {
  if (!AAR_API_KEY) return undefined
  const keyHash = createHash('sha256').update(AAR_API_KEY).digest('hex')
  const db = getDb()
  const row = db.prepare(
    'SELECT account_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL'
  ).get(keyHash) as { account_id: string } | undefined
  return row?.account_id
}

const server = new McpServer({
  name: 'agent-api-registry',
  version: '0.1.0',
})

server.tool(
  'discover_apis',
  'Search available API providers. Returns provider names, categories, descriptions, and proxy URLs.',
  {
    query: z.string().optional().describe('Filter providers by name or category'),
    category: z.string().optional().describe('Filter by category: ai, payments, email, communications'),
  },
  async ({ query, category }) => {
    const accountId = resolveAccountId()
    let providers = listProviders(accountId, PROXY_URL)

    if (category) {
      providers = providers.filter(p => p.category === category)
    }
    if (query) {
      const q = query.toLowerCase()
      providers = providers.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      )
    }

    const text = providers.length === 0
      ? 'No providers found matching your query.'
      : providers.map(p =>
        `**${p.name}** (${p.category})\n` +
        `  ${p.description}\n` +
        `  Proxy: ${p.proxyBaseUrl}\n` +
        `  Docs: ${p.docsUrl}\n` +
        `  Connected: ${p.connected ? 'yes' : 'no'}`
      ).join('\n\n')

    return { content: [{ type: 'text' as const, text }] }
  }
)

server.tool(
  'check_budget',
  'Check current spending and remaining budget for your account.',
  {},
  async () => {
    const accountId = resolveAccountId()
    if (!accountId) {
      return {
        content: [{
          type: 'text' as const,
          text: 'No account configured. Set AAR_API_KEY environment variable.'
        }]
      }
    }

    const budget = checkBudget(accountId)
    const text = budget.limitCents === 0
      ? `Spent: $${(budget.spentCents / 100).toFixed(2)} (no budget limit set)`
      : `Spent: $${(budget.spentCents / 100).toFixed(2)} / $${(budget.limitCents / 100).toFixed(2)} ` +
        `(${budget.utilizationPct}% used)\n` +
        `Remaining: $${(budget.remainingCents / 100).toFixed(2)}\n` +
        `Status: ${budget.blocked ? 'BLOCKED — budget exceeded' : 'active'}`

    return { content: [{ type: 'text' as const, text }] }
  }
)

server.tool(
  'get_proxy_url',
  'Get the proxy URL and usage instructions for a specific API provider.',
  {
    provider: z.string().describe('Provider ID (e.g., "openai", "stripe", "resend")'),
  },
  async ({ provider }) => {
    const accountId = resolveAccountId()
    const info = getProviderInfo(provider, accountId, PROXY_URL)

    if (!info) {
      return {
        content: [{
          type: 'text' as const,
          text: `Unknown provider: ${provider}. Use discover_apis to see available providers.`
        }]
      }
    }

    const text = `**${info.name}** — ${info.description}\n\n` +
      `Proxy Base URL: ${info.proxyBaseUrl}\n` +
      `Docs: ${info.docsUrl}\n` +
      `Connected: ${info.connected ? 'yes' : 'no — add your API key first'}\n\n` +
      `**Usage:**\n` +
      `Make requests to \`${info.proxyBaseUrl}/...\` instead of \`${info.docsUrl}\`.\n` +
      `Include your AAR API key: \`Authorization: Bearer aar_sk_...\`\n\n` +
      `Example:\n` +
      `\`\`\`bash\n` +
      `curl ${info.proxyBaseUrl}/v1/... \\\n` +
      `  -H "Authorization: Bearer $AAR_API_KEY" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -d '{ ... }'\n` +
      `\`\`\``

    return { content: [{ type: 'text' as const, text }] }
  }
)

server.tool(
  'get_recent_spend',
  'Get recent API call spend events for your account.',
  {
    limit: z.number().optional().default(10).describe('Number of recent events to return'),
  },
  async ({ limit }) => {
    const accountId = resolveAccountId()
    if (!accountId) {
      return {
        content: [{
          type: 'text' as const,
          text: 'No account configured. Set AAR_API_KEY environment variable.'
        }]
      }
    }

    const events = getRecentSpendEvents(accountId, limit)
    if (events.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No spend events yet.' }] }
    }

    const text = events.map(e =>
      `${e.createdAt} | ${e.provider} ${e.method} ${e.endpoint} | $${(e.costCents / 100).toFixed(4)} | ${e.responseStatus}`
    ).join('\n')

    return { content: [{ type: 'text' as const, text: `Recent spend:\n${text}` }] }
  }
)

// start MCP server
const transport = new StdioServerTransport()
await server.connect(transport)
