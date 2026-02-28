import { sendColdEmailPlaybook } from './send-cold-email.js'
import { researchProspectPlaybook } from './research-prospect.js'
import { createPaymentLinkPlaybook } from './create-payment-link.js'
import type { PlaybookManifest } from '../core/playbook-schema.js'

export const seedPlaybooks: PlaybookManifest[] = [
  sendColdEmailPlaybook,
  researchProspectPlaybook,
  createPaymentLinkPlaybook,
]
