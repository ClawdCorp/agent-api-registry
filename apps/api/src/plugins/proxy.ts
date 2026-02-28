import fp from 'fastify-plugin'
import { getAdapter } from '../adapters/index.js'
import { getDb } from '../db/client.js'
import { decrypt } from '../core/crypto.js'
import { checkBudget } from '../core/budget.js'
import { checkAccountRpm, releaseAccountRpm } from '../core/account-rpm.js'
import { ProxyEngine, ProxyEngineError } from '../core/proxy-engine.js'

const proxyEngine = new ProxyEngine()

export default fp(async function proxyPlugin(app) {
  // wildcard route: ALL /:provider/*
  app.all('/:provider/*', async (req, reply) => {
    const { provider } = req.params as { provider: string; '*': string }
    const restPath = (req.params as { '*': string })['*']

    // resolve adapter (quick check before doing auth/budget work)
    const adapter = getAdapter(provider)
    if (!adapter) {
      return reply.code(404).send({
        error: 'provider_not_found',
        message: `unknown provider: ${provider}`,
        available: ['openai', 'anthropic', 'stripe', 'resend', 'twilio']
      })
    }

    // auth required for proxy
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized', message: 'API key required for proxy calls' })
    }

    // budget check (pre-call)
    const budget = checkBudget(req.accountId)
    if (budget.blocked) {
      return reply.code(429).send({
        error: 'budget_exceeded',
        message: 'monthly budget cap reached',
        budget: {
          spent_cents: budget.spentCents,
          limit_cents: budget.limitCents,
          remaining_cents: budget.remainingCents
        }
      })
    }

    // per-account RPM check
    const rpm = checkAccountRpm(req.accountId)
    if (!rpm.allowed) {
      return reply.code(429).send({
        error: 'rate_limited',
        message: 'account RPM limit exceeded',
        rpm: { current: rpm.current, limit: rpm.limit }
      })
    }

    // get provider key (BYOK)
    const db = getDb()
    const keyRow = db.prepare(
      'SELECT encrypted_key, iv FROM provider_keys WHERE account_id = ? AND provider = ?'
    ).get(req.accountId, provider) as { encrypted_key: string; iv: string } | undefined

    if (!keyRow) {
      return reply.code(400).send({
        error: 'provider_not_configured',
        message: `no API key configured for ${provider}. Add one via POST /v1/account/providers/${provider}`
      })
    }

    const providerApiKey = decrypt(keyRow.encrypted_key, keyRow.iv)

    // delegate to ProxyEngine
    try {
      const result = await proxyEngine.execute(
        {
          provider,
          method: req.method,
          path: restPath,
          headers: req.headers as Record<string, string | string[] | undefined>,
          body: req.body,
        },
        { type: 'provided', key: providerApiKey },
        req.accountId,
      )

      // SSE stream passthrough
      if (result.stream) {
        reply.raw.writeHead(result.status, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        const reader = result.stream.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            reply.raw.write(value)
          }
        } catch { /* client disconnect */ }
        reply.raw.end()
        return reply
      }

      // map ProxyResponse back to Fastify reply
      reply.status(result.status)
      for (const [key, value] of Object.entries(result.headers)) {
        reply.header(key, value)
      }
      return reply.send(result.body)
    } catch (err) {
      releaseAccountRpm(req.accountId)
      if (err instanceof ProxyEngineError) {
        return reply.code(err.statusCode).send({
          error: err.code,
          message: err.message,
        })
      }
      // unexpected error
      const message = err instanceof Error ? err.message : 'unknown error'
      return reply.code(500).send({
        error: 'internal_error',
        message,
      })
    }
  })
})
