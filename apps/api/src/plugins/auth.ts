import fp from 'fastify-plugin'
import { createHash } from 'node:crypto'
import { getDb } from '../db/client.js'

declare module 'fastify' {
  interface FastifyRequest {
    accountId?: string
  }
}

export default fp(async function authPlugin(app) {
  app.decorateRequest('accountId', undefined)

  app.addHook('onRequest', async (req, reply) => {
    // routes that never require auth
    const skipPaths = ['/health', '/webhooks', '/v1/account/verify', '/v1/account/recover']
    if (skipPaths.some(p => req.url.startsWith(p))) return

    // routes that allow optional auth (enrich but don't block)
    const optionalAuthPaths = ['/v1/providers', '/v1/playbooks', '/v1/executions']
    const isOptional = optionalAuthPaths.some(p => req.url.startsWith(p))

    // allow account creation without auth (signup)
    const isSignup = req.url === '/v1/account' && req.method === 'POST'

    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer aar_sk_')) {
      if (isOptional || isSignup) return
      return reply.code(401).send({ error: 'unauthorized', message: 'valid API key required' })
    }

    const apiKey = authHeader.slice(7) // strip "Bearer "
    const keyHash = createHash('sha256').update(apiKey).digest('hex')

    const db = getDb()
    const row = db.prepare(
      'SELECT account_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL'
    ).get(keyHash) as { account_id: string } | undefined

    if (!row) {
      if (isOptional) return
      return reply.code(401).send({ error: 'unauthorized', message: 'invalid or revoked API key' })
    }

    req.accountId = row.account_id
  })
})
