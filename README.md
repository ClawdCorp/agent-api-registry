# agent-api-registry

mvp: agent api directory + broker with scoped auth and hard budget controls.

## core goals
- discover APIs quickly
- broker calls without exposing raw provider secrets
- enforce spend controls per agent/run/workspace
- audit every call and dollar

## mvp decisions (from thread)
- user zero: agent dev builders
- include transactional APIs at launch
- auth v1: api key first
- budget behavior: finish current step, block next
- billing: post-call reconciliation (not estimate-only)
- access: both direct http + sdk
- launch providers: openai, anthropic, stripe, resend, twilio
- provider onboarding: community submissions + security gating
- tenancy: team/multi-tenant

## docs
- `docs/spec.md` — product + technical spec
- `docs/issues.md` — import-ready issue breakdown
