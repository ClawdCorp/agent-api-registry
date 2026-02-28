import fp from 'fastify-plugin'
import { getAdapter } from '../adapters/index.js'
import { getDb } from '../db/client.js'
import { decrypt } from '../core/crypto.js'
import { checkBudget, checkAndAlertThresholds } from '../core/budget.js'
import { logSpendEvent } from '../core/spend.js'

export default fp(async function proxyPlugin(app) {
  // wildcard route: ALL /:provider/*
  app.all('/:provider/*', async (req, reply) => {
    const { provider } = req.params as { provider: string; '*': string }
    const restPath = (req.params as { '*': string })['*']

    // resolve adapter
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

    // check blocked patterns
    if (adapter.blockedPatterns) {
      const reqLine = `${req.method} /${restPath}`
      for (const pattern of adapter.blockedPatterns) {
        if (pattern.test(reqLine)) {
          return reply.code(403).send({
            error: 'blocked_endpoint',
            message: `this endpoint is blocked for safety: ${req.method} /${restPath}`
          })
        }
      }
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

    // get provider key
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

    // build outbound request
    const targetUrl = `${adapter.baseUrl}/${restPath}`
    const outboundHeaders = adapter.buildOutboundHeaders(
      req.headers as Record<string, string | string[] | undefined>,
      providerApiKey
    )

    // ensure content-type is passed
    if (req.headers['content-type'] && !outboundHeaders['content-type']) {
      outboundHeaders['content-type'] = req.headers['content-type'] as string
    }

    const startMs = Date.now()
    let responseStatus = 0
    let responseBody: unknown = null

    try {
      const fetchOptions: RequestInit = {
        method: req.method,
        headers: outboundHeaders,
      }

      // pass body for non-GET requests
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const rawBody = req.body
        fetchOptions.body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)
      }

      const providerRes = await fetch(targetUrl, fetchOptions)
      const latencyMs = Date.now() - startMs
      responseStatus = providerRes.status

      // read response body
      const contentType = providerRes.headers.get('content-type') ?? ''
      let bodyText: string
      if (contentType.includes('application/json')) {
        responseBody = await providerRes.json()
        bodyText = JSON.stringify(responseBody)
      } else {
        bodyText = await providerRes.text()
        responseBody = bodyText
      }

      // meter the call (async-ish but in same request for simplicity)
      const usage = adapter.extractUsage(req.method, `/${restPath}`, req.body, responseStatus, responseBody)
      logSpendEvent({
        accountId: req.accountId,
        provider,
        method: req.method,
        endpoint: `/${restPath}`,
        costCents: usage?.costCents ?? 0,
        responseStatus,
        latencyMs
      })

      // check threshold alerts
      checkAndAlertThresholds(req.accountId)

      // pass through response
      reply.status(providerRes.status)
      // forward safe response headers
      for (const [key, value] of providerRes.headers.entries()) {
        if (!['transfer-encoding', 'connection', 'content-encoding', 'content-length'].includes(key.toLowerCase())) {
          reply.header(key, value)
        }
      }

      return reply.send(contentType.includes('application/json') ? responseBody : bodyText)
    } catch (err) {
      const latencyMs = Date.now() - startMs
      // log failed call
      logSpendEvent({
        accountId: req.accountId,
        provider,
        method: req.method,
        endpoint: `/${restPath}`,
        costCents: 0,
        responseStatus: 502,
        latencyMs
      })

      const message = err instanceof Error ? err.message : 'unknown error'
      return reply.code(502).send({
        error: 'proxy_error',
        message: `failed to reach ${provider}: ${message}`
      })
    }
  })
})
