import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { listProviders, getProviderInfo } from './core/catalog.js'
import { checkBudget } from './core/budget.js'
import { getBalance } from './core/credits.js'
import { getRecentSpendEvents } from './core/spend.js'
import { PlaybookExecutor } from './core/playbook-executor.js'
import type { PlaybookManifest } from './core/playbook-schema.js'
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
    const balanceCents = getBalance(accountId)
    const text = (budget.limitCents === 0
      ? `Spent: $${(budget.spentCents / 100).toFixed(2)} (no budget limit set)`
      : `Spent: $${(budget.spentCents / 100).toFixed(2)} / $${(budget.limitCents / 100).toFixed(2)} ` +
        `(${budget.utilizationPct}% used)\n` +
        `Remaining: $${(budget.remainingCents / 100).toFixed(2)}\n` +
        `Status: ${budget.blocked ? 'BLOCKED — budget exceeded' : 'active'}`) +
      `\nCredits: $${(balanceCents / 100).toFixed(2)} available`

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

server.tool(
  'list_playbooks',
  'List playbooks installed on your account. Shows available workflows you can execute, with their input requirements and costs.',
  {
    query: z.string().optional().describe('Filter by name or description'),
    industry: z.string().optional().describe('Filter by industry tag'),
  },
  async ({ query, industry }) => {
    const accountId = resolveAccountId()
    if (!accountId) {
      return {
        content: [{
          type: 'text' as const,
          text: 'No account configured. Set AAR_API_KEY environment variable.'
        }]
      }
    }

    const db = getDb()
    const rows = db.prepare(`
      SELECT playbooks.*
      FROM playbook_installs
      JOIN playbooks
        ON playbooks.id = playbook_installs.playbook_id
       AND playbooks.version = playbook_installs.version_pinned
      WHERE playbook_installs.account_id = ?
        AND playbook_installs.uninstalled_at IS NULL
    `).all(accountId) as Array<{
      id: string
      version: string
      name: string
      description: string
      author_id: string
      industry: string
      input_schema: string
      output_schema: string
      steps: string
      estimated_cost_cents_min: number
      estimated_cost_cents_max: number
      providers: string
    }>

    let playbooks = rows

    if (query) {
      const q = query.toLowerCase()
      playbooks = playbooks.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      )
    }

    if (industry) {
      const ind = industry.toLowerCase()
      playbooks = playbooks.filter(p => {
        const industries: string[] = JSON.parse(p.industry)
        return industries.some(i => i.toLowerCase() === ind)
      })
    }

    if (playbooks.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No playbooks found.' }] }
    }

    const text = playbooks.map(p => {
      const industries: string[] = JSON.parse(p.industry)
      const providers: string[] = JSON.parse(p.providers)
      const inputSchema = JSON.parse(p.input_schema) as Record<string, unknown>
      const inputKeys = Object.keys(inputSchema.properties ?? inputSchema)
      return `**${p.id}** v${p.version}\n` +
        `  ${p.description}\n` +
        `  Industry: ${industries.join(', ')}\n` +
        `  Providers: ${providers.join(', ')}\n` +
        `  Cost: $${(p.estimated_cost_cents_min / 100).toFixed(2)} - $${(p.estimated_cost_cents_max / 100).toFixed(2)}\n` +
        `  Input: { ${inputKeys.join(', ')} }`
    }).join('\n\n')

    return { content: [{ type: 'text' as const, text }] }
  }
)

server.tool(
  'execute_playbook',
  'Execute an installed playbook with the given inputs. Reserves credits, runs all steps, and returns the result.',
  {
    playbook_id: z.string().describe('The playbook ID to execute'),
    input: z.record(z.string(), z.unknown()).describe('Input parameters matching the playbook\'s inputSchema'),
  },
  async ({ playbook_id, input }) => {
    const accountId = resolveAccountId()
    if (!accountId) {
      return {
        content: [{
          type: 'text' as const,
          text: 'No account configured. Set AAR_API_KEY environment variable.'
        }]
      }
    }

    const db = getDb()

    // Look up the install to get version_pinned
    const install = db.prepare(`
      SELECT version_pinned FROM playbook_installs
      WHERE account_id = ? AND playbook_id = ? AND uninstalled_at IS NULL
    `).get(accountId, playbook_id) as { version_pinned: string } | undefined

    if (!install) {
      return {
        content: [{
          type: 'text' as const,
          text: `Playbook "${playbook_id}" is not installed on your account. Use list_playbooks to see available playbooks.`
        }]
      }
    }

    // Look up the playbook manifest from DB
    const row = db.prepare(
      'SELECT * FROM playbooks WHERE id = ? AND version = ?'
    ).get(playbook_id, install.version_pinned) as {
      id: string
      version: string
      name: string
      description: string
      author_id: string
      industry: string
      input_schema: string
      output_schema: string
      steps: string
      estimated_cost_cents_min: number
      estimated_cost_cents_max: number
      providers: string
    } | undefined

    if (!row) {
      return {
        content: [{
          type: 'text' as const,
          text: `Playbook manifest not found for "${playbook_id}" v${install.version_pinned}.`
        }]
      }
    }

    // Reconstruct PlaybookManifest from DB row
    const manifest: PlaybookManifest = {
      id: row.id,
      version: row.version,
      name: row.name,
      description: row.description,
      author: row.author_id,
      industry: JSON.parse(row.industry),
      inputSchema: JSON.parse(row.input_schema),
      outputSchema: JSON.parse(row.output_schema),
      steps: JSON.parse(row.steps),
      estimatedCostCents: { min: row.estimated_cost_cents_min, max: row.estimated_cost_cents_max },
      providers: JSON.parse(row.providers),
    }

    try {
      const result = await new PlaybookExecutor().execute(accountId, manifest, input)

      if (result.status === 'completed') {
        const outputLines = result.output
          ? Object.entries(result.output).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n')
          : '  (none)'

        const text = `Playbook executed successfully!\n` +
          `Status: ${result.status}\n` +
          `Cost: $${(result.totalCostCents / 100).toFixed(2)}\n` +
          `Steps: ${result.stepsCompleted}/${result.stepsTotal} completed\n\n` +
          `Output:\n${outputLines}\n\n` +
          `Execution ID: ${result.executionId}`

        return { content: [{ type: 'text' as const, text }] }
      }

      // Failed or partial
      const outputLines = result.output
        ? Object.entries(result.output).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n')
        : null

      const failedAtStep = result.stepsCompleted + 1
      const text = `Playbook execution failed.\n` +
        `Status: ${result.status}\n` +
        `Steps: ${result.stepsCompleted}/${result.stepsTotal} completed (failed at step ${failedAtStep})\n` +
        `Error: ${result.error ?? 'unknown'}\n` +
        (outputLines ? `\nPartial output:\n${outputLines}\n` : '') +
        `\nExecution ID: ${result.executionId}`

      return { content: [{ type: 'text' as const, text }] }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'unknown error'
      return {
        content: [{
          type: 'text' as const,
          text: `Failed to execute playbook: ${errorMsg}`
        }]
      }
    }
  }
)

// start MCP server
const transport = new StdioServerTransport()
await server.connect(transport)
