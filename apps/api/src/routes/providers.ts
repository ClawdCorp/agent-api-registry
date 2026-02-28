import fp from 'fastify-plugin'
import { randomUUID } from 'node:crypto'
import { listProviders, getProviderInfo } from '../core/catalog.js'
import { getAdapter } from '../adapters/index.js'
import { getDb } from '../db/client.js'
import { encrypt } from '../core/crypto.js'

export default fp(async function providerRoutes(app) {
  // list all available providers
  app.get('/v1/providers', async (req) => {
    return { data: listProviders(req.accountId) }
  })

  // get single provider details
  app.get('/v1/providers/:providerId', async (req, reply) => {
    const { providerId } = req.params as { providerId: string }
    const info = getProviderInfo(providerId, req.accountId)
    if (!info) {
      return reply.code(404).send({ error: 'not_found', message: `provider ${providerId} not found` })
    }
    return info
  })

  // store a provider API key
  app.post('/v1/account/providers/:provider', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const { provider } = req.params as { provider: string }
    const body = req.body as { key?: string; label?: string }

    const adapter = getAdapter(provider)
    if (!adapter) {
      return reply.code(404).send({ error: 'not_found', message: `unknown provider: ${provider}` })
    }

    if (!body.key) {
      return reply.code(400).send({ error: 'bad_request', message: 'key is required' })
    }

    if (!adapter.validateKeyFormat(body.key)) {
      return reply.code(400).send({
        error: 'bad_request',
        message: `invalid key format for ${provider}`
      })
    }

    const { encrypted, iv } = encrypt(body.key)
    const id = `pk_${randomUUID().replace(/-/g, '').slice(0, 16)}`

    const db = getDb()
    db.prepare(`
      INSERT INTO provider_keys (id, account_id, provider, encrypted_key, iv, label)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, provider) DO UPDATE SET
        encrypted_key = excluded.encrypted_key,
        iv = excluded.iv,
        label = excluded.label
    `).run(id, req.accountId, provider, encrypted, iv, body.label ?? null)

    return reply.code(201).send({
      id,
      provider,
      label: body.label ?? null,
      key_prefix: body.key.slice(0, 8) + '...'
    })
  })

  // remove a provider API key
  app.delete('/v1/account/providers/:provider', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const { provider } = req.params as { provider: string }
    const db = getDb()
    const result = db.prepare(
      'DELETE FROM provider_keys WHERE account_id = ? AND provider = ?'
    ).run(req.accountId, provider)

    if (result.changes === 0) {
      return reply.code(404).send({ error: 'not_found', message: `no key found for ${provider}` })
    }

    return { ok: true, provider }
  })
})
