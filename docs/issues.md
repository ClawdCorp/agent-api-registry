# issue breakdown (import-ready)

## epic: foundation + tenancy

### [P0] workspace and team rbac model
**description**
implement workspace/org/member/role entities and enforcement middleware.

**acceptance criteria**
- roles: owner/admin/dev/viewer
- every protected endpoint checks workspace scope + role
- invitation flow works end-to-end

**dependencies**
- none

### [P0] auth/session for humans + api tokens for machine clients
**acceptance criteria**
- human login works
- machine token issuance/revocation works
- token scopes are workspace-bound

## epic: vault + scoped auth

### [P0] encrypted credential vault (api-key first)
**acceptance criteria**
- envelope encryption in place
- raw secret never returned after create
- rotate/revoke lifecycle supported

### [P0] scoped broker token minting
**acceptance criteria**
- claims include provider/endpoint/rate/usd cap/expiry
- overscoped or expired token rejected

## epic: broker + policy engine

### [P0] broker gateway core
**acceptance criteria**
- pass-through request/response path works
- call is linked to workspace/project/agent/run
- trace id emitted for each call

### [P0] policy engine v1 (allowlist + caps + limits)
**acceptance criteria**
- endpoint allowlist enforced
- monthly + per-run + burst caps enforced
- deny reason machine-readable

### [P0] finish-then-block hard-cap behavior
**acceptance criteria**
- in-flight call completes
- next step blocked when cap crossed
- block reason visible in run timeline

### [P1] dual access mode: direct http + official sdk
**acceptance criteria**
- both modes use identical policy/audit pipeline
- sdk exposes retries, idempotency, and typed errors

## epic: metering + billing

### [P0] pre-call estimate + post-call reconciliation
**acceptance criteria**
- estimate logged pre-dispatch
- actual cost reconciled post-call
- delta tracked and queryable

### [P0] spend ledger + threshold alerts
**acceptance criteria**
- immutable spend events
- 50/80/95 alerts emitted once per threshold crossing
- monthly totals reconcile with ledger

## epic: provider directory + trust

### [P1] provider catalog + filtering
**acceptance criteria**
- searchable by category/auth/pricing/latency/tier
- provider profile has docs/signup/rate-limit/pricing summary

### [P1] community submission + moderation queue
**acceptance criteria**
- anyone can submit listing
- unreviewed listings cannot be broker-enabled
- moderation status visible

### [P1] trust tier workflow (tier0-3)
**acceptance criteria**
- tier gating enforced by broker
- only tier2+ callable

## epic: dashboard + reporting

### [P1] spend dashboard + drilldown
**acceptance criteria**
- views by day/provider/agent/project
- click-through to call-level records

### [P1] failure and latency observability
**acceptance criteria**
- failure leaderboard by provider/endpoint
- p50/p95 latency surfaced

### [P1] exports (csv/json)
**acceptance criteria**
- permission-aware exports
- signed download links + audit events

## epic: security + hardening

### [P0] egress allowlist enforcement
**acceptance criteria**
- only approved provider domains callable
- bypass attempts blocked + logged

### [P0] request signing + replay protection
**acceptance criteria**
- signed requests validated
- nonce/timestamp replay checks enforced

### [P0] pii/log redaction
**acceptance criteria**
- auth headers and secrets never persisted
- sensitive fields redacted at ingest

## provider adapters (launch)

### [P0] provider adapter: openai
### [P0] provider adapter: anthropic
### [P0] provider adapter: stripe
### [P0] provider adapter: resend
### [P0] provider adapter: twilio

**acceptance criteria (all adapters)**
- key validation
- endpoint mapping
- usage extraction
- reconciliation mapping
- normalized error model
