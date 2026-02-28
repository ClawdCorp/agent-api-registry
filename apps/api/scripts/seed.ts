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

const db = getDb()

// create test account
const accountId = `acct_${randomUUID().replace(/-/g, '').slice(0, 16)}`
const email = 'demo@aar.dev'
db.prepare('INSERT OR IGNORE INTO accounts (id, email, name, monthly_budget_cents) VALUES (?, ?, ?, ?)')
  .run(accountId, email, 'Demo Account', 10000) // $100 budget

// create API key
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
