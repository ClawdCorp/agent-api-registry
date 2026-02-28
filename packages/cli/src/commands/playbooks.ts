import { Command } from 'commander'
import { api } from '../client.js'

export const playbooksCommand = new Command('playbooks')
  .description('List available playbooks')
  .option('--industry <industry>', 'Filter by industry')
  .option('--installed', 'Show only installed playbooks')
  .action(async (opts) => {
    const params = new URLSearchParams()
    if (opts.industry) params.set('industry', opts.industry)
    if (opts.installed) params.set('installed', 'true')
    const qs = params.toString() ? `?${params}` : ''

    const data = await api<{ data: any[] }>('GET', `/v1/playbooks${qs}`)
    if (data.data.length === 0) {
      console.log('No playbooks found.')
      return
    }

    console.log(`${'ID'.padEnd(24)} ${'Name'.padEnd(30)} ${'Industry'.padEnd(16)} Price`)
    console.log('-'.repeat(80))
    for (const p of data.data) {
      const price = p.price_cents_per_exec ? `$${(p.price_cents_per_exec / 100).toFixed(2)}` : 'free'
      console.log(`${(p.id ?? '').padEnd(24)} ${(p.name ?? '').padEnd(30)} ${(p.industry ?? '').padEnd(16)} ${price}`)
    }
  })
