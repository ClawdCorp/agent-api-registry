import fp from 'fastify-plugin'
import { getRecentSpendEvents } from '../core/spend.js'
import { checkBudget } from '../core/budget.js'

export default fp(async function spendRoutes(app) {
  // get recent spend events
  app.get('/v1/spend', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const query = req.query as { limit?: string }
    const parsedLimit = parseInt(query.limit ?? '50', 10)
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50
    const events = getRecentSpendEvents(req.accountId, limit)

    return { data: events, count: events.length }
  })

  // get budget status
  app.get('/v1/budget', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const budget = checkBudget(req.accountId)
    return {
      spent_cents: budget.spentCents,
      limit_cents: budget.limitCents,
      remaining_cents: budget.remainingCents === Infinity ? null : budget.remainingCents,
      utilization_pct: budget.utilizationPct,
      blocked: budget.blocked
    }
  })
})
