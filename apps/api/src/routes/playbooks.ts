import fp from 'fastify-plugin'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/client.js'
import { validateManifest } from '../core/playbook-schema.js'
import type { PlaybookManifest } from '../core/playbook-schema.js'
import { PlaybookExecutor, InputValidationError } from '../core/playbook-executor.js'

// ---------------------------------------------------------------------------
// Types for DB rows
// ---------------------------------------------------------------------------

interface PlaybookRow {
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
  price_cents_per_exec: number
  author_share_pct: number
  status: string
  created_at: string
}

interface PlaybookRowWithCount extends PlaybookRow {
  install_count: number
}

interface InstallRow {
  id: string
  account_id: string
  playbook_id: string
  version_pinned: string
  installed_at: string
  uninstalled_at: string | null
}

interface ExecutionRow {
  id: string
  account_id: string
  playbook_id: string
  playbook_version: string
  status: string
  input: string
  output: string | null
  total_cost_cents: number | null
  credit_txn_id: string | null
  steps_completed: number
  steps_total: number
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPlaybook(row: PlaybookRowWithCount) {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    author_id: row.author_id,
    industry: JSON.parse(row.industry),
    input_schema: JSON.parse(row.input_schema),
    output_schema: JSON.parse(row.output_schema),
    steps: JSON.parse(row.steps),
    estimated_cost_cents: {
      min: row.estimated_cost_cents_min,
      max: row.estimated_cost_cents_max,
    },
    providers: JSON.parse(row.providers),
    price_cents_per_exec: row.price_cents_per_exec,
    author_share_pct: row.author_share_pct,
    status: row.status,
    install_count: row.install_count,
    created_at: row.created_at,
  }
}

function formatPlaybookBasic(row: PlaybookRow) {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    author_id: row.author_id,
    industry: JSON.parse(row.industry),
    input_schema: JSON.parse(row.input_schema),
    output_schema: JSON.parse(row.output_schema),
    steps: JSON.parse(row.steps),
    estimated_cost_cents: {
      min: row.estimated_cost_cents_min,
      max: row.estimated_cost_cents_max,
    },
    providers: JSON.parse(row.providers),
    price_cents_per_exec: row.price_cents_per_exec,
    author_share_pct: row.author_share_pct,
    status: row.status,
    created_at: row.created_at,
  }
}

function rowToManifest(row: PlaybookRow): PlaybookManifest {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    author: row.author_id,
    industry: JSON.parse(row.industry),
    inputSchema: JSON.parse(row.input_schema),
    outputSchema: JSON.parse(row.output_schema),
    steps: JSON.parse(row.steps),
    estimatedCostCents: {
      min: row.estimated_cost_cents_min,
      max: row.estimated_cost_cents_max,
    },
    providers: JSON.parse(row.providers),
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export default fp(async function playbookRoutes(app) {
  // =========================================================================
  // Admin / Author Endpoints
  // =========================================================================

  // POST /v1/playbooks — publish a playbook
  app.post('/v1/playbooks', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'API key required' })
    }

    const validation = validateManifest(req.body)
    if (!validation.success) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'invalid playbook manifest',
        details: validation.errors,
      })
    }

    const manifest = validation.data
    const db = getDb()

    // Check for duplicate (id, version)
    const existing = db.prepare(
      'SELECT id FROM playbooks WHERE id = ? AND version = ?'
    ).get(manifest.id, manifest.version) as { id: string } | undefined

    if (existing) {
      return reply.code(409).send({
        error: 'conflict',
        message: `playbook ${manifest.id}@${manifest.version} already exists`,
      })
    }

    db.prepare(`
      INSERT INTO playbooks
        (id, version, name, description, author_id, industry, input_schema, output_schema,
         steps, estimated_cost_cents_min, estimated_cost_cents_max, providers,
         price_cents_per_exec, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
    `).run(
      manifest.id,
      manifest.version,
      manifest.name,
      manifest.description,
      req.accountId,
      JSON.stringify(manifest.industry),
      JSON.stringify(manifest.inputSchema),
      JSON.stringify(manifest.outputSchema),
      JSON.stringify(manifest.steps),
      manifest.estimatedCostCents.min,
      manifest.estimatedCostCents.max,
      JSON.stringify(manifest.providers),
      0, // price_cents_per_exec defaults to 0
    )

    const created = db.prepare(`
      SELECT p.*, 0 AS install_count
      FROM playbooks p
      WHERE p.id = ? AND p.version = ?
    `).get(manifest.id, manifest.version) as PlaybookRowWithCount

    return reply.code(201).send(formatPlaybook(created))
  })

  // GET /v1/playbooks — list published playbooks
  app.get('/v1/playbooks', async (req) => {
    const query = req.query as {
      industry?: string
      provider?: string
      search?: string
    }

    const db = getDb()
    const conditions: string[] = ["p.status = 'published'"]
    const params: unknown[] = []

    if (query.industry) {
      conditions.push("p.industry LIKE ?")
      params.push(`%"${query.industry}"%`)
    }

    if (query.provider) {
      conditions.push("p.providers LIKE ?")
      params.push(`%"${query.provider}"%`)
    }

    if (query.search) {
      conditions.push("(p.name LIKE ? OR p.description LIKE ?)")
      params.push(`%${query.search}%`, `%${query.search}%`)
    }

    const where = conditions.join(' AND ')

    // For each playbook id, pick the latest version (max rowid per id)
    const rows = db.prepare(`
      SELECT p.*,
             COALESCE(ic.cnt, 0) AS install_count
      FROM playbooks p
      INNER JOIN (
        SELECT id, MAX(rowid) AS max_rowid
        FROM playbooks
        WHERE status = 'published'
        GROUP BY id
      ) latest ON p.rowid = latest.max_rowid
      LEFT JOIN (
        SELECT playbook_id, COUNT(*) AS cnt
        FROM playbook_installs
        WHERE uninstalled_at IS NULL
        GROUP BY playbook_id
      ) ic ON ic.playbook_id = p.id
      WHERE ${where}
      ORDER BY p.created_at DESC
    `).all(...params) as PlaybookRowWithCount[]

    return { data: rows.map(formatPlaybook), count: rows.length }
  })

  // GET /v1/playbooks/:id — get latest published version
  app.get('/v1/playbooks/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    const row = db.prepare(`
      SELECT p.*,
             COALESCE(ic.cnt, 0) AS install_count
      FROM playbooks p
      LEFT JOIN (
        SELECT playbook_id, COUNT(*) AS cnt
        FROM playbook_installs
        WHERE uninstalled_at IS NULL
        GROUP BY playbook_id
      ) ic ON ic.playbook_id = p.id
      WHERE p.id = ? AND p.status = 'published'
      ORDER BY p.created_at DESC
      LIMIT 1
    `).get(id) as PlaybookRowWithCount | undefined

    if (!row) {
      return reply.code(404).send({ error: 'not_found', message: `playbook ${id} not found` })
    }

    return formatPlaybook(row)
  })

  // GET /v1/playbooks/:id/versions — list all versions
  app.get('/v1/playbooks/:id/versions', async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    const rows = db.prepare(`
      SELECT * FROM playbooks WHERE id = ? ORDER BY created_at DESC
    `).all(id) as PlaybookRow[]

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: `playbook ${id} not found` })
    }

    return { data: rows.map(formatPlaybookBasic) }
  })

  // =========================================================================
  // Consumer Endpoints (auth required)
  // =========================================================================

  // POST /v1/account/playbooks/:id/install
  app.post('/v1/account/playbooks/:id/install', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'API key required' })
    }

    const { id } = req.params as { id: string }
    const body = (req.body ?? {}) as { version?: string }
    const db = getDb()

    // Find the playbook
    let playbook: PlaybookRow | undefined

    if (body.version) {
      playbook = db.prepare(
        "SELECT * FROM playbooks WHERE id = ? AND version = ? AND status = 'published'"
      ).get(id, body.version) as PlaybookRow | undefined
    } else {
      playbook = db.prepare(
        "SELECT * FROM playbooks WHERE id = ? AND status = 'published' ORDER BY created_at DESC LIMIT 1"
      ).get(id) as PlaybookRow | undefined
    }

    if (!playbook) {
      return reply.code(404).send({
        error: 'not_found',
        message: body.version
          ? `playbook ${id}@${body.version} not found or not published`
          : `playbook ${id} not found or not published`,
      })
    }

    const installId = `pi_${randomUUID().replace(/-/g, '').slice(0, 16)}`

    // Upsert: insert or update if already installed (including re-install after uninstall)
    db.prepare(`
      INSERT INTO playbook_installs (id, account_id, playbook_id, version_pinned, installed_at, uninstalled_at)
      VALUES (?, ?, ?, ?, datetime('now'), NULL)
      ON CONFLICT(account_id, playbook_id) DO UPDATE SET
        version_pinned = excluded.version_pinned,
        installed_at = datetime('now'),
        uninstalled_at = NULL
    `).run(installId, req.accountId, id, playbook.version)

    return reply.code(201).send({
      installed: true,
      playbook_id: id,
      version_pinned: playbook.version,
    })
  })

  // DELETE /v1/account/playbooks/:id/install — soft-delete
  app.delete('/v1/account/playbooks/:id/install', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'API key required' })
    }

    const { id } = req.params as { id: string }
    const db = getDb()

    const result = db.prepare(
      "UPDATE playbook_installs SET uninstalled_at = datetime('now') WHERE account_id = ? AND playbook_id = ? AND uninstalled_at IS NULL"
    ).run(req.accountId, id)

    if (result.changes === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'playbook not installed' })
    }

    return { uninstalled: true }
  })

  // GET /v1/account/playbooks — list installed playbooks
  app.get('/v1/account/playbooks', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'API key required' })
    }

    const db = getDb()

    const rows = db.prepare(`
      SELECT i.id AS install_id, i.playbook_id, i.version_pinned, i.installed_at,
             p.name, p.description, p.author_id, p.industry, p.providers,
             p.estimated_cost_cents_min, p.estimated_cost_cents_max,
             p.price_cents_per_exec, p.status
      FROM playbook_installs i
      JOIN playbooks p ON p.id = i.playbook_id AND p.version = i.version_pinned
      WHERE i.account_id = ? AND i.uninstalled_at IS NULL
      ORDER BY i.installed_at DESC
    `).all(req.accountId) as Array<{
      install_id: string
      playbook_id: string
      version_pinned: string
      installed_at: string
      name: string
      description: string
      author_id: string
      industry: string
      providers: string
      estimated_cost_cents_min: number
      estimated_cost_cents_max: number
      price_cents_per_exec: number
      status: string
    }>

    const data = rows.map((r) => ({
      install_id: r.install_id,
      playbook_id: r.playbook_id,
      version_pinned: r.version_pinned,
      installed_at: r.installed_at,
      name: r.name,
      description: r.description,
      author_id: r.author_id,
      industry: JSON.parse(r.industry),
      providers: JSON.parse(r.providers),
      estimated_cost_cents: {
        min: r.estimated_cost_cents_min,
        max: r.estimated_cost_cents_max,
      },
      price_cents_per_exec: r.price_cents_per_exec,
      status: r.status,
    }))

    return { data, count: data.length }
  })

  // POST /v1/playbooks/:id/execute — execute a playbook
  app.post('/v1/playbooks/:id/execute', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'API key required' })
    }

    const { id } = req.params as { id: string }
    const body = (req.body ?? {}) as { input?: Record<string, unknown> }
    const db = getDb()

    // Verify playbook is installed
    const install = db.prepare(
      'SELECT * FROM playbook_installs WHERE account_id = ? AND playbook_id = ? AND uninstalled_at IS NULL'
    ).get(req.accountId, id) as InstallRow | undefined

    if (!install) {
      return reply.code(403).send({
        error: 'not_installed',
        message: `playbook ${id} is not installed — install it first`,
      })
    }

    // Look up playbook by pinned version
    const playbook = db.prepare(
      'SELECT * FROM playbooks WHERE id = ? AND version = ?'
    ).get(id, install.version_pinned) as PlaybookRow | undefined

    if (!playbook) {
      return reply.code(404).send({
        error: 'not_found',
        message: `playbook ${id}@${install.version_pinned} not found`,
      })
    }

    // Parse manifest
    const manifest = rowToManifest(playbook)

    // Execute
    const executor = new PlaybookExecutor()
    try {
      const result = await executor.execute(
        req.accountId,
        manifest,
        body.input ?? {},
      )
      return result
    } catch (err) {
      if (err instanceof InputValidationError) {
        return reply.code(400).send({
          error: 'validation_error',
          message: err.message,
          fields: err.fields,
        })
      }
      const message = err instanceof Error ? err.message : 'execution failed'
      return reply.code(500).send({ error: 'execution_error', message })
    }
  })

  // GET /v1/playbooks/:id/executions — list executions for a playbook
  app.get('/v1/playbooks/:id/executions', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'API key required' })
    }

    const { id } = req.params as { id: string }
    const query = req.query as { limit?: string }
    const limit = Math.min(Math.max(parseInt(query.limit ?? '20', 10) || 20, 1), 100)
    const db = getDb()

    const rows = db.prepare(`
      SELECT * FROM playbook_executions
      WHERE account_id = ? AND playbook_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(req.accountId, id, limit) as ExecutionRow[]

    const data = rows.map((r) => ({
      ...r,
      input: JSON.parse(r.input),
      output: r.output ? JSON.parse(r.output) : null,
    }))

    return { data, count: data.length }
  })

  // GET /v1/executions/:executionId — get single execution
  app.get('/v1/executions/:executionId', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'API key required' })
    }

    const { executionId } = req.params as { executionId: string }
    const db = getDb()

    const row = db.prepare(
      'SELECT * FROM playbook_executions WHERE id = ?'
    ).get(executionId) as ExecutionRow | undefined

    if (!row) {
      return reply.code(404).send({ error: 'not_found', message: 'execution not found' })
    }

    if (row.account_id !== req.accountId) {
      return reply.code(403).send({ error: 'forbidden', message: 'execution belongs to another account' })
    }

    return {
      ...row,
      input: JSON.parse(row.input),
      output: row.output ? JSON.parse(row.output) : null,
    }
  })
})
