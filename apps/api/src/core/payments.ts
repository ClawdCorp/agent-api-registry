import { randomUUID } from 'node:crypto'

export interface PaymentProvider {
  createCheckoutSession(accountId: string, amountCents: number): Promise<{ sessionId: string; approved: boolean }>
  verifyPayment(sessionId: string): Promise<{ verified: boolean; amountCents: number }>
}

class MockPaymentProvider implements PaymentProvider {
  async createCheckoutSession(accountId: string, amountCents: number) {
    const sessionId = `mock_cs_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    return { sessionId, approved: true }
  }

  async verifyPayment(sessionId: string) {
    // Mock always verifies — caller tracks amount
    return { verified: true, amountCents: 0 }
  }
}

export function getPaymentProvider(): PaymentProvider {
  const provider = process.env.PAYMENT_PROVIDER ?? 'mock'
  if (provider === 'mock') return new MockPaymentProvider()
  throw new Error(`Unknown payment provider: ${provider}`)
}
