import { Command } from 'commander'
import { api } from '../client.js'

export const installCommand = new Command('install')
  .description('Install a playbook to your account')
  .argument('<playbook-id>', 'ID of the playbook to install')
  .option('--version <version>', 'Pin to a specific version')
  .action(async (playbookId: string, opts) => {
    const body: Record<string, string> = {}
    if (opts.version) body.version = opts.version

    const result = await api<{ id: string; playbook_id: string }>('POST', `/v1/account/playbooks/${playbookId}/install`, body)
    console.log(`Installed playbook: ${result.playbook_id}`)
  })
