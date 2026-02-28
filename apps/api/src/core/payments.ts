import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { getDb } from '../db/client.js'

export interface CheckoutResult {
  sessionId: string
  approved: boolean
  checkoutUrl?: string
}

export interface PaymentProvider {
  createCheckoutSession(accountId: string, amountCents: number): Promise<CheckoutResult>
  verifyPayment(sessionId: string): Promise<{ verified: boolean; amountCents: number }>
}

class MockPaymentProvider implements PaymentProvider {
  async createCheckoutSession(_accountId: string, _amountCents: number): Promise<CheckoutResult> {
    const sessionId = `mock_cs_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    return { sessionId, approved: true }
  }

  async verifyPayment(_sessionId: string) {
    return { verified: true, amountCents: 0 }
  }
}

class StripePaymentProvider implements PaymentProvider {
  private stripe: Stripe

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe')
    this.stripe = new Stripe(key)
  }

  async createCheckoutSession(accountId: string, amountCents: number): Promise<CheckoutResult> {
    const customerId = await this.getOrCreateCustomer(accountId)
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'AAR Credits' },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      mode: 'payment',
      metadata: { account_id: accountId, amount_cents: String(amountCents) },
      success_url: `${appUrl}/credits?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/credits?cancelled=true`,
    })

    return {
      sessionId: session.id,
      approved: false, // credits granted via webhook, not synchronously
      checkoutUrl: session.url ?? undefined,
    }
  }

  async verifyPayment(sessionId: string) {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId)
    return {
      verified: session.payment_status === 'paid',
      amountCents: session.amount_total ?? 0,
    }
  }

  private async getOrCreateCustomer(accountId: string): Promise<string> {
    const db = getDb()
    const existing = db.prepare(
      'SELECT stripe_customer_id FROM stripe_customers WHERE account_id = ?'
    ).get(accountId) as { stripe_customer_id: string } | undefined

    if (existing) return existing.stripe_customer_id

    const account = db.prepare('SELECT email FROM accounts WHERE id = ?')
      .get(accountId) as { email: string }

    const customer = await this.stripe.customers.create({
      email: account.email,
      metadata: { account_id: accountId },
    })

    db.prepare(
      'INSERT INTO stripe_customers (account_id, stripe_customer_id) VALUES (?, ?)'
    ).run(accountId, customer.id)

    return customer.id
  }
}

let cachedProvider: PaymentProvider | undefined

export function getPaymentProvider(): PaymentProvider {
  if (cachedProvider) return cachedProvider
  const providerType = process.env.PAYMENT_PROVIDER ?? 'mock'
  if (providerType === 'stripe') {
    cachedProvider = new StripePaymentProvider()
  } else {
    cachedProvider = new MockPaymentProvider()
  }
  return cachedProvider
}
