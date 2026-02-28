import fp from 'fastify-plugin'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { getDb } from '../db/client.js'
import { sendEmail } from '../core/email.js'

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
    // Generate verification token
    const verificationToken = randomBytes(32).toString('hex')
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    db.prepare(
      'INSERT INTO accounts (id, email, name, verification_token, verification_expires) VALUES (?, ?, ?, ?, ?)'
    ).run(id, body.email, body.name ?? null, verificationToken, verificationExpires)

    // Send verification email (async, non-blocking)
    const appUrl = process.env.APP_URL ?? 'http://localhost:4000'
    sendEmail(
      body.email,
      'Verify your AAR account',
      `Verify your account by calling:\n\nPOST ${appUrl}/v1/account/verify\n{"token": "${verificationToken}"}\n\nThis link expires in 24 hours.`,
    ).catch(() => {}) // don't block signup on email failure

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
      'SELECT id, email, name, monthly_budget_cents, rpm_limit, email_verified, created_at FROM accounts WHERE id = ?'
    ).get(req.accountId) as { id: string; email: string; name: string | null; monthly_budget_cents: number; rpm_limit: number; email_verified: number; created_at: string }

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

  // verify email
  app.post('/v1/account/verify', async (req, reply) => {
    const body = req.body as { token?: string }
    if (!body.token) {
      return reply.code(400).send({ error: 'bad_request', message: 'token is required' })
    }

    const db = getDb()
    const account = db.prepare(
      'SELECT id, verification_expires FROM accounts WHERE verification_token = ? AND email_verified = 0'
    ).get(body.token) as { id: string; verification_expires: string } | undefined

    if (!account) {
      return reply.code(400).send({ error: 'invalid_token', message: 'invalid or expired verification token' })
    }

    if (new Date(account.verification_expires) < new Date()) {
      return reply.code(400).send({ error: 'token_expired', message: 'verification token has expired' })
    }

    db.prepare(
      'UPDATE accounts SET email_verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?'
    ).run(account.id)

    return { ok: true, message: 'email verified' }
  })

  // request account recovery
  app.post('/v1/account/recover', async (req, reply) => {
    const body = req.body as { email?: string }
    if (!body.email) {
      return reply.code(400).send({ error: 'bad_request', message: 'email is required' })
    }

    // Always return 200 to prevent email enumeration
    const db = getDb()
    const account = db.prepare('SELECT id, email FROM accounts WHERE email = ?')
      .get(body.email) as { id: string; email: string } | undefined

    if (account) {
      const recoveryToken = randomBytes(32).toString('hex')
      const recoveryExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour

      db.prepare(
        'UPDATE accounts SET recovery_token = ?, recovery_expires = ? WHERE id = ?'
      ).run(recoveryToken, recoveryExpires, account.id)

      const appUrl = process.env.APP_URL ?? 'http://localhost:4000'
      sendEmail(
        account.email,
        'AAR Account Recovery',
        `Recover your account by calling:\n\nPOST ${appUrl}/v1/account/recover/confirm\n{"token": "${recoveryToken}"}\n\nThis link expires in 1 hour.`,
      ).catch(() => {})
    }

    return { ok: true, message: 'if an account exists with that email, a recovery email has been sent' }
  })

  // confirm account recovery — issues new API key
  app.post('/v1/account/recover/confirm', async (req, reply) => {
    const body = req.body as { token?: string }
    if (!body.token) {
      return reply.code(400).send({ error: 'bad_request', message: 'token is required' })
    }

    const db = getDb()
    const account = db.prepare(
      'SELECT id FROM accounts WHERE recovery_token = ?'
    ).get(body.token) as { id: string } | undefined

    if (!account) {
      return reply.code(400).send({ error: 'invalid_token', message: 'invalid or expired recovery token' })
    }

    const row = db.prepare('SELECT recovery_expires FROM accounts WHERE id = ?')
      .get(account.id) as { recovery_expires: string }

    if (new Date(row.recovery_expires) < new Date()) {
      return reply.code(400).send({ error: 'token_expired', message: 'recovery token has expired' })
    }

    // Revoke all existing keys
    db.prepare(
      "UPDATE api_keys SET revoked_at = datetime('now') WHERE account_id = ? AND revoked_at IS NULL"
    ).run(account.id)

    // Issue new API key
    const apiKey = `aar_sk_${randomBytes(24).toString('hex')}`
    const keyHash = createHash('sha256').update(apiKey).digest('hex')
    const keyId = `key_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    db.prepare(
      'INSERT INTO api_keys (id, account_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?, ?)'
    ).run(keyId, account.id, keyHash, apiKey.slice(0, 14), 'recovery')

    // Clear recovery token
    db.prepare(
      'UPDATE accounts SET recovery_token = NULL, recovery_expires = NULL WHERE id = ?'
    ).run(account.id)

    return reply.code(201).send({
      api_key: apiKey,
      message: 'all previous API keys have been revoked. Save this new key — it will not be shown again.',
    })
  })
})
