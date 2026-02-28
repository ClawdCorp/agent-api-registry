/**
 * Seed script — creates a test account with API key and optionally adds provider keys.
 *
 * Usage:
 *   AAR_MASTER_KEY=<64-hex-chars> tsx scripts/seed.ts
 *
 * Env vars for provider keys (optional):
 *   OPENAI_API_KEY, ANTHROPIC_API_KEY, STRIPE_API_KEY, RESEND_API_KEY, TWILIO_API_KEY
 */

import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { getDb } from '../src/db/client.js'
import { encrypt } from '../src/core/crypto.js'
import { purchaseCredits } from '../src/core/credits.js'
import { seedPlaybooks } from '../src/playbooks/index.js'

const db = getDb()

// create or find existing demo account
const email = 'demo@aar.dev'
let accountId: string

const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email) as { id: string } | undefined
if (existing) {
  accountId = existing.id
  // reset budget on re-seed
  db.prepare('UPDATE accounts SET monthly_budget_cents = 10000 WHERE id = ?').run(accountId)
} else {
  accountId = `acct_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  db.prepare('INSERT INTO accounts (id, email, name, monthly_budget_cents) VALUES (?, ?, ?, ?)')
    .run(accountId, email, 'Demo Account', 10000) // $100 budget
}

// create a fresh API key (always, so re-running gives a new key)
const apiKey = `aar_sk_${randomBytes(24).toString('hex')}`
const keyHash = createHash('sha256').update(apiKey).digest('hex')
const keyId = `key_${randomUUID().replace(/-/g, '').slice(0, 16)}`
db.prepare('INSERT INTO api_keys (id, account_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?, ?)')
  .run(keyId, accountId, keyHash, apiKey.slice(0, 14), 'demo-key')

console.log('\n=== Agent API Registry — Demo Account ===\n')
console.log(`  Account ID : ${accountId}`)
console.log(`  Email      : ${email}`)
console.log(`  API Key    : ${apiKey}`)
console.log(`  Budget     : $100.00/month`)

// add provider keys from env
const providerEnvMap: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  stripe: 'STRIPE_API_KEY',
  resend: 'RESEND_API_KEY',
  twilio: 'TWILIO_API_KEY',
}

console.log('\n  Provider Keys:')
for (const [provider, envVar] of Object.entries(providerEnvMap)) {
  const key = process.env[envVar]
  if (key) {
    const { encrypted, iv } = encrypt(key)
    const pkId = `pk_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    db.prepare(`
      INSERT OR REPLACE INTO provider_keys (id, account_id, provider, encrypted_key, iv, label)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(pkId, accountId, provider, encrypted, iv, `from ${envVar}`)
    console.log(`    ${provider}: added (from ${envVar})`)
  } else {
    console.log(`    ${provider}: skipped (set ${envVar} to add)`)
  }
}

// seed platform provider keys from env
console.log('\n  Platform Provider Keys:')
for (const [provider, envVar] of Object.entries(providerEnvMap)) {
  const key = process.env[envVar]
  if (key) {
    const { encrypted, iv } = encrypt(key)
    const ppkId = `ppk_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    db.prepare(`
      INSERT INTO platform_provider_keys (id, provider, encrypted_key, iv, label, rpm_limit)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(ppkId, provider, encrypted, iv, `platform ${envVar}`, 60)
    console.log(`    ${provider}: added (from ${envVar})`)
  } else {
    console.log(`    ${provider}: skipped (set ${envVar} to add)`)
  }
}

// create admin account if not exists
const adminEmail = 'admin@aar.dev'
const existingAdmin = db.prepare('SELECT id FROM accounts WHERE email = ?').get(adminEmail) as { id: string } | undefined
if (!existingAdmin) {
  const adminId = `acct_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  db.prepare('INSERT INTO accounts (id, email, name) VALUES (?, ?, ?)').run(adminId, adminEmail, 'Admin')
  const adminApiKey = `aar_sk_${randomBytes(24).toString('hex')}`
  const adminKeyHash = createHash('sha256').update(adminApiKey).digest('hex')
  const adminKeyId = `key_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  db.prepare('INSERT INTO api_keys (id, account_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?, ?)')
    .run(adminKeyId, adminId, adminKeyHash, adminApiKey.slice(0, 14), 'admin-key')
  console.log(`\n  Admin Account:`)
  console.log(`    Email    : ${adminEmail}`)
  console.log(`    API Key  : ${adminApiKey}`)
} else {
  console.log(`\n  Admin Account: already exists`)
}

// seed credits for demo account ($100 = 10000 cents)
const creditTxn = purchaseCredits(accountId, 10000, {
  referenceType: 'seed',
  referenceId: 'seed-script',
  description: 'Seed credits for demo account',
})
console.log(`\n  Credits     : $100.00 (balance: ${creditTxn.balanceAfterCents} cents)`)

// seed playbooks
console.log('\n  Seed Playbooks:')
for (const playbook of seedPlaybooks) {
  db.prepare(`
    INSERT OR REPLACE INTO playbooks (id, version, name, description, author_id, industry, input_schema, output_schema, steps, estimated_cost_cents_min, estimated_cost_cents_max, providers, price_cents_per_exec, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
  `).run(
    playbook.id, playbook.version, playbook.name, playbook.description,
    accountId,
    JSON.stringify(playbook.industry), JSON.stringify(playbook.inputSchema),
    JSON.stringify(playbook.outputSchema), JSON.stringify(playbook.steps),
    playbook.estimatedCostCents.min, playbook.estimatedCostCents.max,
    JSON.stringify(playbook.providers), 0
  )
  console.log(`    ${playbook.id} v${playbook.version}: seeded`)

  // Auto-install for demo account
  const installId = `pi_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  db.prepare(`
    INSERT OR REPLACE INTO playbook_installs (id, account_id, playbook_id, version_pinned)
    VALUES (?, ?, ?, ?)
  `).run(installId, accountId, playbook.id, playbook.version)
}
console.log('    (all auto-installed for demo account)')

console.log('\n=== Quick Start ===\n')
console.log(`  # Set your API key`)
console.log(`  export AAR_API_KEY="${apiKey}"`)
console.log(``)
console.log(`  # Start the server`)
console.log(`  AAR_MASTER_KEY=${process.env.AAR_MASTER_KEY} pnpm dev:api`)
console.log(``)
console.log(`  # Test the proxy (if OpenAI key was provided)`)
console.log(`  curl http://localhost:4000/openai/v1/chat/completions \\`)
console.log(`    -H "Authorization: Bearer $AAR_API_KEY" \\`)
console.log(`    -H "Content-Type: application/json" \\`)
console.log(`    -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello!"}]}'`)
console.log(``)
console.log(`  # Check spend`)
console.log(`  curl http://localhost:4000/v1/spend -H "Authorization: Bearer $AAR_API_KEY"`)
console.log(``)
console.log(`  # Check budget`)
console.log(`  curl http://localhost:4000/v1/budget -H "Authorization: Bearer $AAR_API_KEY"`)
console.log('')
