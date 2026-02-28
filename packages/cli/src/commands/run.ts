import { Command } from 'commander'
import { api } from '../client.js'

export const runCommand = new Command('run')
  .description('Execute a playbook')
  .argument('<playbook-id>', 'ID of the playbook to run')
  .option('--input <pairs...>', 'Input values as key=value pairs')
  .action(async (playbookId: string, opts) => {
    const input: Record<string, string> = {}
    if (opts.input) {
      for (const pair of opts.input as string[]) {
        const eqIdx = pair.indexOf('=')
        if (eqIdx === -1) {
          console.error(`Invalid input format: "${pair}". Use key=value`)
          process.exit(1)
        }
        input[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1)
      }
    }

    console.log(`Running playbook: ${playbookId}...`)
    const result = await api<{
      execution_id: string
      status: string
      output?: unknown
      total_cost_cents?: number
      steps_completed?: number
      steps_total?: number
      error?: string
    }>('POST', `/v1/playbooks/${playbookId}/execute`, { input })

    console.log(`Status: ${result.status}`)
    console.log(`Steps:  ${result.steps_completed ?? 0}/${result.steps_total ?? '?'}`)

    if (result.total_cost_cents !== undefined) {
      console.log(`Cost:   $${(result.total_cost_cents / 100).toFixed(2)}`)
    }

    if (result.error) {
      console.error(`Error: ${result.error}`)
    }

    if (result.output) {
      console.log(`\nOutput:`)
      console.log(JSON.stringify(result.output, null, 2))
    }
  })
