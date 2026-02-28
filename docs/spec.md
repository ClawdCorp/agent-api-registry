# Agent API Registry — Vision & Roadmap

## The Vision

**AAR is the playbook directory for automating your industry.**

Domain experts share "here's how I automated my outbound pipeline" on Twitter every day. AAR turns those automations into **executable, billed playbooks** that anyone can install with one command and run through any AI agent. The domain expert becomes a playbook author who earns per execution. The person who sees the tweet loads $20 in credits and runs the playbook immediately.

**A playbook** = domain knowledge + prompt instructions + execution infrastructure + per-use billing. It teaches an AI agent how to accomplish a specific outcome (e.g., "send a personalized cold email", "research a prospect", "create a payment link") and charges per execution.

**Composio gives agents tools. AAR gives industries playbooks.**

### Two-Sided Marketplace

- **Authors** = domain experts who encode industry knowledge as playbooks (sales ops people, recruiters, content creators, real estate agents — not just developers)
- **Consumers** = anyone in that industry who wants to automate (not just developers)

### What Makes AAR Different

No existing player combines all five of these properties:

1. **Agent-native execution** — not human-in-the-loop like Zapier/Make
2. **Domain expert authored** — not developer-only like Composio/OpenClaw
3. **Per-execution billing with author revenue share** — not free like ClawHub's 5,700 unmonetized skills
4. **Composed workflows** — not atomic tool calls like Composio
5. **Agent-agnostic** — not locked to one framework like OpenClaw

### Two Tiers of Playbooks

- **Tier 1 (now):** Stateless capabilities — single-action playbooks (send email, create payment link, research prospect). The agent provides all inputs, the playbook executes and returns a result. No user context required.
- **Tier 2 (later):** Multi-step workflows — orchestrated sequences (full outbound campaign, onboarding flow). Requires user data access, state management, scheduling. Much harder. Not in scope until post-product-market-fit.

---

## Architecture

### How It Works

```
Consumer's Agent (Claude Code, Cursor, custom)
        |
   MCP / HTTP
        |
   AAR Platform
   ├── Playbook Layer          ← list_playbooks, execute_playbook, check_budget
   │   └── PlaybookExecutor    ← Runs playbook steps server-side
   ├── Proxy Engine            ← Internal: credential injection, metering (also available directly for power users)
   ├── Credits System          ← Stripe Checkout → balance → per-execution deduction
   └── Provider Adapters       ← OpenAI, Anthropic, Stripe, Resend, Twilio
```

**Two access modes:**
- **Playbook-first (primary):** Consumer installs a playbook → agent calls `execute_playbook` → AAR runs the steps server-side → returns result → deducts credits
- **Proxy-first (power users):** Developer calls the raw proxy directly (e.g., `POST /openai/v1/chat/completions`) with their own orchestration. BYOK or credits.

### Playbook Execution Model

Playbooks execute **server-side**. The agent calls a single MCP tool (`execute_playbook`) or HTTP endpoint (`POST /v1/playbooks/:id/execute`) with inputs. AAR's PlaybookExecutor runs each step internally via the proxy engine. The agent never sees individual API calls, internal prompts, or the execution sequence.

This matters because:
- **Protects author IP** — prompts and step sequences are not exposed to the consumer
- **Cross-agent compatibility** — same MCP tool interface works in Claude Code, Cursor, or any MCP-compatible agent
- **Accurate metering** — AAR controls the execution, so cost tracking is precise

**Meta-tool pattern** (not dynamic tool registration):
```typescript
server.tool('execute_playbook', 'Execute an installed playbook by ID', {
  playbook_id: z.string(),
  input: z.record(z.unknown()),
}, async ({ playbook_id, input }) => {
  const result = await playbookExecutor.execute(accountId, playbook_id, input);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
```

### MCP Server Tools

**Primary (playbook) path:**
- `list_playbooks` — List installed playbooks with descriptions, input schemas, estimated costs
- `execute_playbook` — Run a playbook with provided inputs, returns result
- `check_budget` — Get credit balance: `{ balance, spent_this_month, remaining }`

**Power-user (proxy) path (kept from Phase 0):**
- `discover_apis` — Search available API providers
- `get_proxy_url` — Get proxy URL and auth instructions for direct API calls
- `get_recent_spend` — Recent spend events with costs

### Playbook Manifest Format

```typescript
interface PlaybookManifest {
  id: string;
  version: string;
  name: string;                    // "Send Cold Email"
  description: string;             // Human-readable description of the outcome
  author: string;                  // Author account ID
  industry: string[];              // ["sales", "outbound"]
  inputSchema: JSONSchema;         // What the consumer/agent provides
  outputSchema: JSONSchema;        // What comes back
  steps: PlaybookStep[];           // Ordered execution plan
  estimatedCostCents: { min: number; max: number };
  providers: string[];             // ["openai", "resend"]
}

interface PlaybookStep {
  id: string;
  provider: string;                // Must match a registered adapter
  method: string;                  // "POST"
  path: string;                    // "/v1/chat/completions"
  bodyTemplate: object;            // Handlebars-style: {{input.recipient_email}}
  outputExtractor: Record<string, string>;  // JSONPath for result extraction
  onError: 'fail' | 'skip' | 'retry';
}
```

Stored in database as JSON. Versioned (immutable once published). Install pins to a version.

### Database Schema

**Existing (Phase 0 — 6 tables):**

| Table | Purpose |
|-------|---------|
| `accounts` | User account (email, name, monthly_budget_cents, credit_balance_cents) |
| `api_keys` | AAR API keys (key_hash, key_prefix, revoked_at) |
| `provider_keys` | BYOK credentials (AES-256-GCM encrypted) — kept for power-user proxy path |
| `spend_events` | Immutable call log (provider, endpoint, cost_cents, latency_ms) |
| `account_spend_monthly` | Fast rollup for budget checks |
| `budget_alerts` | Dedup threshold alerts (50/80/95%) |

**New (Phase 1):**

| Table | Purpose |
|-------|---------|
| `playbooks` | Manifest, author, version, price_cents_per_exec, author_share_pct, status |
| `playbook_installs` | Per-account install state (account_id, playbook_id, version_pinned) |
| `playbook_executions` | Each run: status, input, output, total_cost_cents, linked credit txn |
| `credit_transactions` | Double-entry ledger: purchase / consumption / refund / payout |
| `stripe_customers` | Maps account_id → stripe_customer_id |
| `platform_provider_keys` | AAR-owned API keys with RPM tracking for key pooling |

### Key Architecture Decisions

1. **Extract proxy logic** from Fastify handler (`plugins/proxy.ts`) into `core/proxy-engine.ts`. The PlaybookExecutor must call the proxy programmatically, not via HTTP self-calls.
2. **Double-entry credit ledger from day one.** Retrofitting accounting invariants is extremely painful.
3. **Platform key pooling.** All consumers share AAR's API keys. Need at least 2 keys per provider with least-loaded routing to avoid rate limit exhaustion.
4. **Externalize provider pricing** from hardcoded adapter values into a config table. This is business-critical when it determines what you charge.
5. **SQLite for Phase 1, PostgreSQL by Phase 2.** Credit ledger is too important for SQLite at scale (~50-100 concurrent users is the ceiling).

---

## Business Model

### Credits System

Consumers load credits via Stripe Checkout. Playbook executions deduct from their balance. Authors earn a share of each execution.

**Pricing structure:**

| Revenue stream | Rate | Rationale |
|---|---|---|
| Platform fee on credit purchases | 5-10% | OpenRouter charges 5.5%; AAR adds playbook curation value |
| Author take rate (marketplace-sourced) | 80-85% to author | Standard for declining take-rate era (Shopify gives first $1M free) |
| Author take rate (author-driven traffic) | 90-95% to author | Rewards authors who bring their own audience |
| Markup on underlying provider costs | 5-15% | Covers key pooling, rate limits, support |

**Reference:** OpenRouter does $8M/month in customer spend with zero markup on costs and a 5.5% platform fee. Started with no VC. Transparent pricing builds trust.

### Credit Flow

1. **Purchase:** Consumer → Stripe Checkout → webhook → insert `credit_transactions` (type=purchase) → increment `credit_balance_cents`
2. **Execution:** Pre-check balance >= estimated cost → reserve amount → run playbook steps → post-execution deduct actual cost → insert consumption transaction
3. **Author payout:** Periodic batch calculates revenue share from `playbook_executions` → Stripe Connect transfer (14-30 day hold for fraud prevention)

### BYOK Remains for Power Users

The raw proxy path (`/:provider/*`) continues to support BYOK credentials. This reduces platform key pressure and lets developers bring their own rate limits. Credits and BYOK coexist: credits for playbook execution, BYOK for direct proxy access.

### Fraud Prevention

- Delayed author payouts: 14-30 days (detect chargebacks before payout)
- Credit expiration: 12 months
- Tiered trust: new accounts get lower execution limits
- Per-account and per-IP rate limiting
- No free signup credits (prevents account farming)
- Per-playbook cost ceilings: flag authors whose actual costs consistently exceed estimates

---

## Competitive Landscape

### Direct Competitors

**Composio** ($29M funded, ~100K devs, 500-850 integrations):
- Pricing: Free 20K calls/mo → $29/mo (200K) → $229/mo (2M)
- MCP support being deprecated — consolidating on own SDK
- Cannot easily pivot to playbooks: would need workflow composition, marketplace economics, domain expert recruitment. Fundamentally different product.

**OpenClaw/ClawHub** (5,700+ skills, 15K+ daily installs):
- **Highest risk competitor.** Already has skill registry + CLI install + active community.
- Missing: billing layer, domain experts, agent-agnostic distribution.
- Time to replicate: 3-6 months. Weakness: open-source ethos may resist monetization; locked to OpenClaw agent.

**Zapier** (8,000+ apps, 30K+ actions):
- Now has MCP support, but architecture mismatch: trigger-action paradigm, GUI-first, pricing penalizes agents (1 MCP call = 2 Zapier tasks).

**n8n** (200K+ community, 5,776 AI workflow templates):
- Open-source Zapier. Has templates but no author monetization or agent-native execution.

**Nango** (600+ APIs, YC W23):
- B2B infra for SaaS companies. Two layers removed from end users. Not a marketplace competitor.

### Threat Timeline

| Competitor | Risk | Time to replicate |
|---|---|---|
| OpenClaw/ClawHub | **HIGH** | 3-6 months |
| Composio | Medium | 6-12 months |
| Toolhouse.ai | Medium | 6-12 months |
| n8n | Medium | 6-12 months |
| Zapier | Medium | 6-12 months |
| Nango | Low | 12+ months |

**Window to establish position: ~6-12 months.**

### AAR's Moat

The moat is **encoded domain knowledge**, not infrastructure. Anyone can build a proxy. Nobody else is building "the app store for industry automation playbooks" with tested + billed + executable capabilities and author economics.

---

## Phased Roadmap

### Phase 0: Execution Engine (COMPLETE)

**What exists today:** Transparent proxy + spend metering + MCP discovery.

- Fastify HTTP server with transparent proxy (`/:provider/*`)
- 5 provider adapters: OpenAI, Anthropic, Stripe, Resend, Twilio
- MCP server (stdio): `discover_apis`, `check_budget`, `get_proxy_url`, `get_recent_spend`
- SQLite database: 6 tables (accounts, api_keys, provider_keys, spend_events, account_spend_monthly, budget_alerts)
- API key auth (SHA-256 hashed, `aar_sk_` prefix)
- AES-256-GCM encrypted provider key storage
- Post-call spend metering with monthly rollup
- Pre-call budget enforcement (429 rejection)
- Account + provider key management APIs
- Seed script for local testing

**Directory structure:**
```
apps/api/src/
  index.ts              — Fastify HTTP server
  mcp.ts                — MCP server entry point (stdio)
  db/
    schema.sql          — SQLite schema (6 tables)
    client.ts           — better-sqlite3 wrapper
  plugins/
    auth.ts             — API key auth
    proxy.ts            — Transparent proxy core
  adapters/
    types.ts            — ProviderAdapter interface
    index.ts            — Adapter registry
    openai.ts, anthropic.ts, stripe.ts, resend.ts, twilio.ts
  routes/
    providers.ts        — Provider listing + key CRUD
    account.ts          — Account + API key management
    spend.ts            — Spend queries + budget status
  core/
    catalog.ts          — Provider catalog logic
    budget.ts           — Budget checks + threshold alerts
    spend.ts            — Spend logging + queries
    crypto.ts           — AES-256-GCM encrypt/decrypt
```

### Phase 1: Playbook MVP

**Goal:** First 3 playbooks executable via MCP/CLI with credits billing. Prove the concept end-to-end.

**Architecture work:**
- [ ] Extract proxy logic from `plugins/proxy.ts` into `core/proxy-engine.ts` (callable function, not HTTP handler)
- [ ] Implement platform key pooling (`platform_provider_keys` table, least-loaded routing)
- [ ] Externalize provider pricing from hardcoded adapter values to config table
- [ ] Add per-account RPM limits alongside budget caps

**Playbook system:**
- [ ] Define playbook manifest schema (TypeScript interface + JSON schema)
- [ ] Add playbook tables to SQLite: `playbooks`, `playbook_installs`, `playbook_executions`
- [ ] Build PlaybookExecutor: validates inputs → reserves credits → runs steps via proxy engine → deducts actual cost → returns result
- [ ] Add MCP tools: `list_playbooks`, `execute_playbook`
- [ ] Add HTTP endpoint: `POST /v1/playbooks/:id/execute`
- [ ] Build 3 Tier 1 playbooks: `send-cold-email`, `research-prospect`, `create-payment-link`

**Credits system:**
- [ ] Add `credit_balance_cents` to accounts, create `credit_transactions` + `stripe_customers` tables
- [ ] Stripe Checkout integration for credit loading
- [ ] Per-execution credit deduction with atomic transactions (`BEGIN IMMEDIATE`)
- [ ] `GET /v1/credits` — balance + transaction history

**CLI:**
- [ ] `aar install <playbook>` — register a playbook in the user's account
- [ ] `aar playbooks` — list installed playbooks
- [ ] `aar credits` — check balance
- [ ] `aar run <playbook> [--input key=value]` — execute from terminal

**Must-fix before external users:**
- [ ] Email verification on signup (currently no verification, unlimited fake accounts possible)
- [ ] Account recovery (if user loses only API key, account is permanently inaccessible)
- [ ] Request body size limits (large responses can OOM the server)
- [ ] Streaming support for AI provider responses (SSE passthrough)

### Phase 2: Marketplace + Industry Verticals

**Goal:** Open to authors. First curated industry packs. PostgreSQL migration.

- Author tools: "describe your automation" → AAR generates playbook manifest → author tests → publishes
- Author revenue share via Stripe Connect (80-85% to author, 14-30 day payout hold)
- Curated industry packs (pick lead vertical based on Phase 1 traction)
- Playbook versioning and regression testing against model updates
- CPO (cost per outcome) analytics dashboard
- Playbook ratings, reviews, install counts
- Trust tiers: unverified → verified → featured
- PostgreSQL migration (credit ledger too important for SQLite at scale)
- Web dashboard: browse catalog, load credits, view execution history, manage account

**Security (required before opening to third-party authors):**
- Playbook sandboxing: validate every step references only authorized providers/endpoints
- Template variable injection prevention
- Per-playbook cost ceilings with actual-vs-estimated monitoring
- Malicious playbook detection (data exfiltration, prompt injection)

### Phase 3: Scale

- Tier 2 workflows (stateful, multi-step, requires user context access)
- Team accounts with shared budgets
- Enterprise playbook libraries (private, org-internal)
- Re-introduce workspace RBAC (code already written, parked in git history)
- KMS-backed credential vault (replace env-var master key)
- Redis for rate limiting + session state
- Multi-region deployment

---

## Cold Start Strategy

Building a two-sided marketplace with no supply and no demand is the hardest problem. Five strategies to bootstrap:

1. **Seed supply yourself.** Create 10-25 high-quality first-party playbooks before recruiting any authors. Amazon sold books before third-party sellers joined.

2. **"Come for the tool, stay for the network."** The CLI/proxy is useful standalone (Phase 0 already works). Playbook marketplace is the network effect that compounds over time.

3. **Atomic network.** Don't launch 3 verticals simultaneously. Pick ONE. Build 5-10 excellent playbooks. Get 10-20 paying users. Then expand.

4. **Subsidize the hard side.** Guarantee early authors minimum earnings or pay them directly for their first 5 playbooks. Recruit 5 expert authors with domain credibility.

5. **Single-player mode.** "Build playbooks for your own agents" is valuable even without the marketplace. Authors get a personal automation tool; publishing is optional.

### Candidate Verticals (pick based on traction)

**Sales/Outbound:**
- `send-cold-email` — Compose and send personalized outreach via Resend
- `research-prospect` — Research a company/person via web search + OpenAI summarization
- `send-sms-followup` — Send SMS follow-up via Twilio
- `create-payment-link` — Create a Stripe checkout for closing

**Content/Marketing:**
- `generate-social-post` — Draft platform-specific social content
- `research-topic` — Deep-research a topic for content creation
- `schedule-newsletter` — Compose and queue a newsletter issue

**Recruiting/HR:**
- `source-candidate-email` — Find and draft personalized outreach to candidates
- `send-interview-followup` — Send structured follow-up after interviews
- `generate-job-description` — Create compelling job posts from role requirements

---

## Known Challenges & Open Questions

### Critical (blocks Phase 1 launch)

1. **Mid-execution credit exhaustion.** If a multi-step playbook runs out of credits mid-way, consumer gets partial/useless result. Solution: pre-execution cost reservation based on estimated max cost, charge only for completed steps, return partial results with clear status.

2. **Playbook format finalization.** Implementation cannot begin without a concrete schema. The manifest interface above is the starting point — needs validation with 3 example playbooks.

3. **Platform key management.** Sharing AAR's API keys across all consumers means rate limits are shared. Key pooling with at least 2 keys per provider is required before credits launch.

### Important (significantly affects UX)

4. **Non-technical consumer UX.** CLI-first assumes technical users, but the target includes normies. Web dashboard is needed for browsing, credit loading, and execution history. Phase 1 can be CLI-only if targeting developers first.

5. **Provider API failure handling.** Who retries? Who rolls back? Are credits refunded for failed steps? Need clear per-step error policy in the manifest (`onError: fail | skip | retry`).

6. **Playbook output quality.** No feedback mechanism exists. Need ratings/reviews by Phase 2 and a way for consumers to dispute charges for bad results.

7. **Idempotency.** If connection drops after a Stripe charge but before response, retrying creates a duplicate. Need idempotency key passthrough for payment providers.

### Security (must address before Phase 2 marketplace)

8. **Malicious playbook prompt injection.** A playbook could instruct agents to exfiltrate data. Server-side execution mitigates this (agent doesn't run the prompts), but step body templates could still embed malicious payloads.

9. **Cost manipulation by authors.** Authors declaring "2 credits" but crafting playbooks that make 50 API calls. Need per-playbook cost ceilings and actual-vs-estimated monitoring.

10. **Data exfiltration via provider calls.** A playbook step could POST consumer data to an author-controlled endpoint. Mitigated today by proxy only allowing 5 hardcoded providers, but needs formal validation in the PlaybookExecutor.

### Scaling (Phase 2-3)

11. **SQLite write contention.** `better-sqlite3` uses synchronous writes that block the Node.js event loop. Ceiling: ~50-100 concurrent users. PostgreSQL migration needed in Phase 2.

12. **Single `AAR_MASTER_KEY`.** No key versioning for rotation. Add `key_version` column to support decryption with multiple master keys.

13. **Hardcoded provider pricing.** The OpenAI adapter uses `$2.50/1M input, $10/1M output` — only correct for gpt-4o. Need a pricing config table that covers all models without code deploys.

---

## Verification Plan

### Phase 0 (existing — all passing):
1. `pnpm --filter api dev` — server starts on port 3001
2. Seed script creates test account with API key + provider keys
3. `POST /openai/v1/chat/completions` through proxy — real GPT response
4. `POST /stripe/v1/charges` through proxy — real Stripe charge (test mode)
5. `GET /v1/spend` — both calls logged with cost
6. Set budget to $0.01, make call — verify 429 rejection
7. MCP server: `discover_apis` returns providers, `check_budget` returns spend/limit

### Phase 1 verification (target):
1. `aar install send-cold-email` — playbook registered in account
2. `aar credits` — shows $0 balance
3. Load $5 via Stripe Checkout — balance updates
4. Agent calls `execute_playbook("send-cold-email", { recipient: "...", context: "..." })` via MCP
5. Playbook executes: OpenAI generates email copy → Resend sends it
6. `aar credits` — shows deduction matching estimated cost
7. `GET /v1/playbooks/send-cold-email/executions` — shows execution with cost breakdown
8. Repeat until credits exhausted — verify graceful rejection with clear message
