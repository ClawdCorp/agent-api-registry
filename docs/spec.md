# Agent API Registry — MVP Roadmap & Architecture

## Context

The current codebase has an overbuilt RBAC/workspace system (4-role hierarchy, invites, HMAC signatures) but no actual proxy, no provider adapters, no metering, and no MCP server. The product vision has crystallized: **"OpenRouter for all APIs"** — a transparent proxy + discovery layer that lets AI agents discover and call any paid API through a single interface with unified spend controls.

This plan strips the architecture down to what matters for a demo-able MVP, then phases the directory moat and enterprise features.

---

## Architecture: The Simplified MVP

### Core Concept

```
Agent (Claude, GPT, custom)
        |
   +----+----+
   |         |
MCP Server  HTTP Proxy
(discover,  (actual API calls)
 budget)    POST /stripe/v1/charges
   |         |
   +----+----+
        |
   Fastify Core
        |
   +----+----+----+----+
   |    |    |    |    |
  Auth Proxy Meter Budget Catalog
  (key) (fwd) (log) (check) (search)
        |
  Provider Adapters
  [openai|anthropic|stripe|resend|twilio]
```

**How the transparent proxy works:**
1. Agent calls `POST proxy.aar.dev/stripe/v1/charges` with `Authorization: Bearer aar_sk_xxx`
2. Auth middleware validates the AAR key, attaches `accountId`
3. Route `/:provider/*` resolves the `stripe` adapter
4. Budget check — if monthly spend >= cap, reject with `429`
5. Adapter injects the real Stripe API key, forwards request to `https://api.stripe.com/v1/charges`
6. Response passes through unchanged to the agent
7. Post-call: log `SpendEvent`, update monthly rollup, check threshold alerts

**Key principle:** Request body and response body are NEVER modified. The proxy only touches auth headers and meters the call.

### MCP Server

Same codebase as the HTTP server (`apps/api/src/mcp.ts`), stdio transport. Exposes 3 tools:
- **`discover_apis`** — Search/list available providers with descriptions, categories, pricing info
- **`check_budget`** — Get remaining budget: `{ spent, limit, remaining }`
- **`get_proxy_url`** — Get proxy base URL + auth instructions for a specific provider

The MCP server does NOT proxy calls itself — it tells the agent how to call the HTTP proxy. MCP = discovery/control channel. HTTP = data channel.

### Provider Adapter Interface

Each adapter is a single file implementing:

```typescript
interface ProviderAdapter {
  id: string                    // "openai", "stripe"
  name: string                  // "OpenAI"
  category: string              // "ai", "payments", "email", "communications"
  baseUrl: string               // "https://api.openai.com"
  description: string           // For agent discovery
  authPattern: { type: 'bearer' | 'basic' | 'header'; headerName?: string }
  buildOutboundHeaders(inbound: Headers, providerKey: string): Headers
  extractUsage(method, path, reqBody, resStatus, resBody): UsageInfo | null
  validateKeyFormat(key: string): boolean
  blockedPatterns?: RegExp[]    // Safety: block dangerous endpoints
}
```

5 adapters: `openai.ts`, `anthropic.ts`, `stripe.ts`, `resend.ts`, `twilio.ts`

### Database: SQLite (6 tables)

| Table | Purpose |
|-------|---------|
| `accounts` | Single-user account (email, name, monthly_budget_cents) |
| `api_keys` | AAR API keys (key_hash, key_prefix, revoked_at) |
| `provider_keys` | BYOK credentials (AES-256-GCM encrypted) |
| `spend_events` | Immutable call log (provider, endpoint, cost_cents, latency_ms) |
| `account_spend_monthly` | Fast rollup for budget checks (account_id, year_month, total_cents) |
| `budget_alerts` | Dedup threshold alerts (50/80/95%) |

No workspaces, no memberships, no invites, no roles.

### What Gets Deleted from Current Code

| File | Action | Reason |
|------|--------|--------|
| `plugins/rbac.ts` | **Delete** | Replaced by simple API key auth |
| `plugins/signature.ts` | **Delete** | Agents auth via API key over HTTPS |
| `rbac/store.ts` | **Delete** | No RBAC in MVP |
| `rbac/types.ts` | **Delete** | No RBAC in MVP |
| `packages/sdk/src/signing.ts` | **Keep (parked)** | Useful for Phase 3 |
| `packages/sdk/src/index.ts` | **Rewrite** | Becomes agent-facing proxy client |

All deleted code is preserved in git history for Phase 3.

### New Directory Structure

```
apps/api/src/
  index.ts              — Fastify HTTP server (proxy + management API)
  mcp.ts                — MCP server entry point (stdio)
  db/
    schema.sql          — SQLite schema (6 tables)
    client.ts           — better-sqlite3 wrapper
  plugins/
    auth.ts             — API key auth (replaces rbac + signature)
    proxy.ts            — Transparent proxy core
    meter.ts            — Post-call spend logging
    budget.ts           — Pre-call budget check
  adapters/
    types.ts            — ProviderAdapter interface
    index.ts            — Adapter registry map
    openai.ts
    anthropic.ts
    stripe.ts
    resend.ts
    twilio.ts
  routes/
    providers.ts        — GET /v1/providers, provider key CRUD
    account.ts          — Account + API key management
    spend.ts            — GET /v1/spend, GET /v1/budget
  core/
    catalog.ts          — Provider catalog logic (shared by HTTP + MCP)
    budget.ts           — Budget logic (shared)
    spend.ts            — Spend query logic (shared)
    crypto.ts           — AES-256-GCM encrypt/decrypt for provider keys
```

---

## Phased Roadmap

### Phase 0: Demo (~1 week)

**Goal:** End-to-end working flow — agent discovers APIs via MCP, makes real calls through proxy, spend is tracked.

| Step | Work | Files |
|------|------|-------|
| 1 | Remove RBAC/signature code, add SQLite + schema | `apps/api/src/index.ts`, `db/schema.sql`, `db/client.ts` |
| 2 | API key auth plugin | `plugins/auth.ts` |
| 3 | Provider adapter interface + OpenAI + Stripe adapters | `adapters/types.ts`, `adapters/openai.ts`, `adapters/stripe.ts` |
| 4 | Transparent proxy plugin | `plugins/proxy.ts` |
| 5 | Spend metering (post-call logging + monthly rollup) | `plugins/meter.ts`, `routes/spend.ts` |
| 6 | Budget enforcement (pre-call check) | `plugins/budget.ts` |
| 7 | MCP server (discover_apis, check_budget, get_proxy_url) | `mcp.ts` |
| 8 | Seed script for test account + demo walkthrough | `scripts/seed.ts` |

**Demo deliverables:**
- Agent discovers OpenAI + Stripe via MCP
- Agent makes real `POST /openai/v1/chat/completions` through proxy
- Agent makes real `POST /stripe/v1/charges` through proxy
- Spend logged and queryable via `GET /v1/spend`
- Budget cap blocks calls when exceeded

### Phase 1: Core MVP (~2-3 weeks)

**Goal:** Usable by early adopters. All 5 providers, real accounts, minimal dashboard.

- Anthropic, Resend, Twilio adapters
- Account management API (create account, manage keys, manage provider keys, set budget)
- Minimal web dashboard (login, key management, provider keys, spend overview, budget settings)
- SDK rewrite — agent-facing proxy client
- CLI tool (`packages/cli`) — `aar login`, `aar keys create`, `aar providers add`, `aar spend`
- Per-account rate limiting
- Error normalization (proxy errors vs provider errors, machine-readable codes)
- PII/log redaction from day 1

### Phase 2: Directory Moat (~4-6 weeks after MVP)

**Goal:** The catalog becomes the competitive advantage.

- Community provider submission API
- Moderation queue + admin review UI
- Trust tiers (Tier 0: listed -> Tier 1: verified -> Tier 2: broker-enabled -> Tier 3: recommended)
- Provider profile pages (docs, pricing, rate limits, health)
- Search/filtering by category, auth type, pricing model
- Generic HTTP adapter for Tier 0/1 providers (proxy without cost extraction)
- Provider health monitoring (synthetic checks, uptime)

### Phase 3: Scale & Harden (~after 100+ users)

- Re-introduce workspace/team RBAC (revive existing code)
- Unified billing (AAR processes payments, marks up costs)
- Request signing re-enabled (revive `signature.ts`)
- KMS-backed credential vault (replace env-var master key)
- PostgreSQL migration from SQLite
- Redis for rate limiting + nonce store
- Multi-region deployment

---

## Issue Triage (Current 24 Issues)

### Keep for Phase 0-1
| # | Title | Change |
|---|-------|--------|
| 10 | Broker gateway core | **Keep as-is** — this IS the product |
| 1 | Provider adapter: OpenAI | **Keep** — Phase 0 |
| 3 | Provider adapter: Stripe | **Keep** — Phase 0 |
| 2 | Provider adapter: Anthropic | **Keep** — Phase 1 |
| 4 | Provider adapter: Resend | **Keep** — Phase 1 |
| 5 | Provider adapter: Twilio | **Keep** — Phase 1 |
| 13 | Dual access (HTTP + SDK) | **Keep** — already the plan |

### Modify / Simplify
| # | Title | Change |
|---|-------|--------|
| 7 | Auth/session | **Simplify** -> API key auth only. No sessions, no JWT. |
| 8 | Encrypted credential vault | **Simplify** -> AES-256-GCM with env-var key. No KMS, no rotation. |
| 11 | Policy engine v1 | **Simplify** -> Monthly budget cap only. No allowlists, no per-run caps. |
| 12 | Finish-then-block | **Simplify** -> Pre-call check, block if exceeded. No in-flight tracking. |
| 14 | Pre-call estimate + reconciliation | **Simplify** -> Post-call metering only. No estimates. |
| 15 | Spend ledger + alerts | **Simplify** -> Ledger + logged alerts (no email/webhook). |
| 16 | Provider catalog | **Simplify** -> Hardcoded from adapter defs for Phase 0. DB-backed in Phase 2. |
| 19 | Spend dashboard | **Simplify** -> Basic table in minimal web panel. |
| 22 | Egress allowlist | **Implicit** — proxy only knows 5 registered providers. No generic passthrough. |
| 24 | PII/log redaction | **Keep but simplify** — never log auth headers or bodies with secrets. |

### Defer
| # | Title | Phase |
|---|-------|-------|
| 6 | Workspace RBAC | Phase 3 (code already written, parked) |
| 9 | Scoped broker tokens | Phase 3 (not needed for single-user) |
| 17 | Community submissions | Phase 2 |
| 18 | Trust tier workflow | Phase 2 |
| 20 | Failure/latency observability | Phase 2 |
| 21 | Exports (CSV/JSON) | Phase 2 |
| 23 | Request signing + replay | Phase 3 (code already written, parked) |

### New Issues Needed
| Title | Phase | Description |
|-------|-------|-------------|
| SQLite database + schema | 0 | Add better-sqlite3, 6-table schema, client wrapper |
| API key auth plugin | 0 | Replace RBAC with simple key-hash auth |
| Transparent proxy plugin | 0 | Core proxy: route matching, adapter resolution, forward, passthrough |
| MCP server | 0 | discover_apis, check_budget, get_proxy_url tools |
| Provider key encryption | 0 | AES-256-GCM for stored BYOK credentials |
| Demo seed script | 0 | Create test account + keys for local testing |
| Account management API | 1 | CRUD for accounts, API keys, provider keys, budgets |
| Minimal web dashboard | 1 | Login, key mgmt, provider keys, spend, budgets |
| CLI tool | 1 | `aar login`, `aar keys`, `aar providers`, `aar spend` |
| SDK rewrite | 1 | Agent-facing proxy client library |
| Per-account rate limiting | 1 | Basic rate limiter on proxy |
| Error normalization | 1 | Consistent error format, machine-readable codes |

---

## Verification Plan

### Phase 0 demo verification:
1. Run `pnpm --filter api dev` — server starts on port 3001
2. Run seed script to create test account with API key + OpenAI/Stripe provider keys
3. `curl POST /openai/v1/chat/completions` through proxy — get a real GPT response
4. `curl POST /stripe/v1/charges` through proxy — get a real Stripe charge (test mode)
5. `curl GET /v1/spend` — see both calls logged with cost
6. Set budget to $0.01, make another call — verify `429` rejection
7. Connect MCP server to Claude Desktop, run `discover_apis` — see providers listed
8. Run `check_budget` — see spend/limit/remaining
