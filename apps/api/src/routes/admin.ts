import fp from 'fastify-plugin'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/client.js'
import { encrypt } from '../core/crypto.js'
import { listPlatformKeys } from '../core/platform-keys.js'

async function requireAdmin(req: { accountId?: string }, reply: { code: (n: number) => { send: (body: unknown) => unknown } }): Promise<boolean> {
  if (!req.accountId) {
    reply.code(401).send({ error: 'unauthorized', message: 'API key required' })
    return false
  }

  const db = getDb()
  const account = db.prepare(
    'SELECT role FROM accounts WHERE id = ?'
  ).get(req.accountId) as { role: string } | undefined

  if (!account || account.role !== 'admin') {
    reply.code(403).send({ error: 'forbidden', message: 'admin access required' })
    return false
  }

  return true
}

export default fp(async function adminRoutes(app) {
  // add a platform key
  app.post('/v1/admin/platform-keys', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return

    const body = (req.body ?? {}) as {
      provider?: string
      key?: string
      label?: string
      rpmLimit?: number
    }

    if (!body.provider) {
      return reply.code(400).send({ error: 'bad_request', message: 'provider is required' })
    }
    if (!body.key) {
      return reply.code(400).send({ error: 'bad_request', message: 'key is required' })
    }

    const { encrypted, iv } = encrypt(body.key)
    const id = `ppk_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const rpmLimit = body.rpmLimit ?? 60

    if (!Number.isInteger(rpmLimit) || rpmLimit < 1) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'rpmLimit must be a positive integer (>= 1)',
      })
    }

    const db = getDb()
    db.prepare(
      'INSERT INTO platform_provider_keys (id, provider, encrypted_key, iv, label, rpm_limit) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, body.provider, encrypted, iv, body.label ?? null, rpmLimit)

    return reply.code(201).send({
      id,
      provider: body.provider,
      label: body.label ?? null,
      rpmLimit,
      keyPrefix: body.key.slice(0, 8) + '...',
    })
  })

  // list platform keys
  app.get('/v1/admin/platform-keys', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return

    const query = req.query as { provider?: string }
    const keys = listPlatformKeys(query.provider)

    return { data: keys, count: keys.length }
  })

  // deactivate a platform key (soft-delete)
  app.delete('/v1/admin/platform-keys/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return

    const { id } = req.params as { id: string }
    const db = getDb()
    const result = db.prepare(
      'UPDATE platform_provider_keys SET active = 0 WHERE id = ? AND active = 1'
    ).run(id)

    if (result.changes === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'key not found or already deactivated' })
    }

    return { ok: true, id }
  })
})
