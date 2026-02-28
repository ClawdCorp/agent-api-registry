import fp from 'fastify-plugin'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { getDb } from '../db/client.js'

export default fp(async function accountRoutes(app) {
  // create account
  app.post('/v1/account', async (req, reply) => {
    const body = req.body as { email?: string; name?: string }
    if (!body.email) {
      return reply.code(400).send({ error: 'bad_request', message: 'email is required' })
    }

    const db = getDb()
    const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(body.email)
    if (existing) {
      return reply.code(409).send({ error: 'conflict', message: 'account already exists' })
    }

    const id = `acct_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    db.prepare(
      'INSERT INTO accounts (id, email, name) VALUES (?, ?, ?)'
    ).run(id, body.email, body.name ?? null)

    // auto-create an API key
    const apiKey = `aar_sk_${randomBytes(24).toString('hex')}`
    const keyHash = createHash('sha256').update(apiKey).digest('hex')
    const keyId = `key_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    db.prepare(
      'INSERT INTO api_keys (id, account_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?, ?)'
    ).run(keyId, id, keyHash, apiKey.slice(0, 14), 'default')

    return reply.code(201).send({
      account: { id, email: body.email, name: body.name ?? null },
      api_key: apiKey,
      message: 'save this API key — it will not be shown again'
    })
  })

  // get account info
  app.get('/v1/account', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const db = getDb()
    const account = db.prepare(
      'SELECT id, email, name, monthly_budget_cents, created_at FROM accounts WHERE id = ?'
    ).get(req.accountId) as { id: string; email: string; name: string | null; monthly_budget_cents: number; created_at: string }

    const keys = db.prepare(
      'SELECT id, key_prefix, name, revoked_at, created_at FROM api_keys WHERE account_id = ? ORDER BY created_at DESC'
    ).all(req.accountId)

    const providers = db.prepare(
      'SELECT provider, label, created_at FROM provider_keys WHERE account_id = ?'
    ).all(req.accountId)

    return { account, api_keys: keys, providers }
  })

  // set monthly budget
  app.put('/v1/account/budget', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const body = req.body as { monthly_budget_cents?: number }
    if (body.monthly_budget_cents === undefined || body.monthly_budget_cents < 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'monthly_budget_cents must be >= 0' })
    }

    const db = getDb()
    db.prepare(
      'UPDATE accounts SET monthly_budget_cents = ? WHERE id = ?'
    ).run(body.monthly_budget_cents, req.accountId)

    return { ok: true, monthly_budget_cents: body.monthly_budget_cents }
  })

  // create additional API key
  app.post('/v1/account/keys', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const body = req.body as { name?: string }
    const apiKey = `aar_sk_${randomBytes(24).toString('hex')}`
    const keyHash = createHash('sha256').update(apiKey).digest('hex')
    const keyId = `key_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const db = getDb()
    db.prepare(
      'INSERT INTO api_keys (id, account_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?, ?)'
    ).run(keyId, req.accountId, keyHash, apiKey.slice(0, 14), body.name ?? null)

    return reply.code(201).send({
      id: keyId,
      api_key: apiKey,
      message: 'save this API key — it will not be shown again'
    })
  })

  // revoke API key
  app.delete('/v1/account/keys/:keyId', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const { keyId } = req.params as { keyId: string }
    const db = getDb()
    const result = db.prepare(
      'UPDATE api_keys SET revoked_at = datetime(\'now\') WHERE id = ? AND account_id = ? AND revoked_at IS NULL'
    ).run(keyId, req.accountId)

    if (result.changes === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'key not found or already revoked' })
    }

    return { ok: true, id: keyId }
  })
})
