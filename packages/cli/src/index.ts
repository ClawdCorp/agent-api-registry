#!/usr/bin/env node
import { Command } from 'commander'
import { playbooksCommand } from './commands/playbooks.js'
import { installCommand } from './commands/install.js'
import { creditsCommand } from './commands/credits.js'
import { runCommand } from './commands/run.js'

const program = new Command()
  .name('aar')
  .description('Agent API Registry — CLI')
  .version('0.1.0')

program.addCommand(playbooksCommand)
program.addCommand(installCommand)
program.addCommand(creditsCommand)
program.addCommand(runCommand)

program.parse()
