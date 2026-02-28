import fp from 'fastify-plugin'
import { getPaymentProvider } from '../core/payments.js'
import { purchaseCredits, getBalance, getTransactionHistory } from '../core/credits.js'
import { getMonthlySpend } from '../core/spend.js'

export default fp(async function creditRoutes(app) {
  // purchase credits
  app.post('/v1/credits/purchase', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const body = (req.body ?? {}) as { amount_cents?: number }
    if (typeof body.amount_cents !== 'number' || !Number.isInteger(body.amount_cents)) {
      return reply.code(400).send({ error: 'bad_request', message: 'amount_cents must be an integer' })
    }
    if (body.amount_cents <= 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'amount_cents must be > 0' })
    }
    if (body.amount_cents > 100000) {
      return reply.code(400).send({ error: 'bad_request', message: 'amount_cents must be <= 100000 ($1000)' })
    }

    const provider = getPaymentProvider()
    const result = await provider.createCheckoutSession(req.accountId, body.amount_cents)

    // Mock provider grants credits synchronously
    if (result.approved) {
      const txn = purchaseCredits(req.accountId, body.amount_cents, {
        referenceType: 'stripe_checkout',
        referenceId: result.sessionId,
        description: 'Credit purchase',
      })
      return {
        balance_cents: txn.balanceAfterCents,
        transaction_id: txn.id,
        session_id: result.sessionId,
      }
    }

    // Stripe returns a checkout URL — credits granted via webhook
    return reply.code(201).send({
      session_id: result.sessionId,
      checkout_url: result.checkoutUrl,
      message: 'Complete payment at checkout_url. Credits will be added automatically.',
    })
  })

  // get credit balance, spend, and transaction history
  app.get('/v1/credits', async (req, reply) => {
    if (!req.accountId) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const query = req.query as { limit?: string }
    const parsedLimit = parseInt(query.limit ?? '20', 10)
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 20

    const balanceCents = getBalance(req.accountId)
    const spentThisMonthCents = getMonthlySpend(req.accountId)
    const transactions = getTransactionHistory(req.accountId, limit)

    return {
      balance_cents: balanceCents,
      spent_this_month_cents: spentThisMonthCents,
      transactions,
    }
  })
})
