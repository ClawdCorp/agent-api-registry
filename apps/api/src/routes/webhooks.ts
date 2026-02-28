import fp from 'fastify-plugin'
import { getDb } from '../db/client.js'
import { purchaseCredits } from '../core/credits.js'

export default fp(async function webhookRoutes(app) {
  // Stripe needs raw body for signature verification
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req: any, body: Buffer, done: (err: null, result: Buffer) => void) => {
      done(null, body)
    },
  )

  app.post('/webhooks/stripe', async (req, reply) => {
    const sig = req.headers['stripe-signature']
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

    if (!sig || !webhookSecret) {
      return reply.code(400).send({ error: 'missing stripe-signature or webhook secret' })
    }

    let event: any
    try {
      const Stripe = require('stripe')
      const stripe = new (Stripe.default ?? Stripe)(process.env.STRIPE_SECRET_KEY)
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      return reply.code(400).send({ error: `webhook signature verification failed: ${message}` })
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const accountId = session.metadata?.account_id
      const amountCents = parseInt(session.metadata?.amount_cents ?? '0', 10)

      if (!accountId || !amountCents) {
        return reply.code(400).send({ error: 'missing metadata on checkout session' })
      }

      // Idempotency: check if credits already granted for this session
      const db = getDb()
      const existing = db.prepare(
        'SELECT id FROM credit_transactions WHERE reference_id = ? AND reference_type = ?'
      ).get(session.id, 'stripe_checkout')

      if (!existing) {
        purchaseCredits(accountId, amountCents, {
          referenceType: 'stripe_checkout',
          referenceId: session.id,
          description: `Stripe checkout ${session.id}`,
        })
      }
    }

    return { received: true }
  })
})
