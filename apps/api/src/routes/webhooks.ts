import type { FastifyInstance } from 'fastify'
import Stripe from 'stripe'
import { getDb } from '../db/client.js'
import { purchaseCredits } from '../core/credits.js'

// NOT wrapped in fastify-plugin — keeps the raw-buffer content type parser
// scoped to this plugin only, so other routes keep normal JSON parsing.
export default async function webhookRoutes(app: FastifyInstance) {
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

    let event: Stripe.Event
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig as string, webhookSecret)
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

      // Idempotency: unique index on (reference_type, reference_id) prevents double-credit.
      // If a concurrent retry already inserted, the UNIQUE constraint violation is caught here.
      try {
        purchaseCredits(accountId, amountCents, {
          referenceType: 'stripe_checkout',
          referenceId: session.id,
          description: `Stripe checkout ${session.id}`,
        })
      } catch (err: any) {
        // UNIQUE constraint violation = already processed, treat as success
        if (err?.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw err
      }
    }

    return { received: true }
  })
}
