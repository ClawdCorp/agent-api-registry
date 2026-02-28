import { Command } from 'commander'
import { api } from '../client.js'

export const creditsCommand = new Command('credits')
  .description('View credit balance and history')
  .action(async () => {
    const data = await api<{
      balance_cents: number
      spent_this_month_cents: number
      transactions: any[]
    }>('GET', '/v1/credits')

    console.log(`Balance:         $${(data.balance_cents / 100).toFixed(2)}`)
    console.log(`Spent this month: $${(data.spent_this_month_cents / 100).toFixed(2)}`)

    if (data.transactions.length > 0) {
      console.log(`\nRecent transactions:`)
      for (const t of data.transactions.slice(0, 10)) {
        const sign = t.type === 'purchase' ? '+' : '-'
        console.log(`  ${t.created_at}  ${t.type.padEnd(14)} ${sign}$${(Math.abs(t.amount_cents) / 100).toFixed(2)}`)
      }
    }
  })

creditsCommand
  .command('buy <amount>')
  .description('Purchase credits (amount in dollars, e.g. "10" for $10)')
  .action(async (amount: string) => {
    const dollars = parseFloat(amount)
    if (isNaN(dollars) || dollars <= 0) {
      console.error('Amount must be a positive number')
      process.exit(1)
    }
    const amountCents = Math.round(dollars * 100)

    const result = await api<{ checkout_url?: string; balance_cents?: number; session_id: string }>(
      'POST', '/v1/credits/purchase', { amount_cents: amountCents }
    )

    if (result.checkout_url) {
      console.log(`Open this URL to complete payment:\n${result.checkout_url}`)
    } else if (result.balance_cents !== undefined) {
      console.log(`Credits added. New balance: $${(result.balance_cents / 100).toFixed(2)}`)
    }
  })
