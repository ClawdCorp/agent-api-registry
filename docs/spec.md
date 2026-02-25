# mvp spec — agent api directory + broker

## problem
agent builders are juggling scattered provider docs, inconsistent auth, and unpredictable spend.

## product thesis
one control plane for provider discovery, scoped credential brokerage, and budget policy enforcement.

## mvp scope
1. provider directory
2. credential vault + scoped token minting
3. request broker (direct http + sdk)
4. policy engine (caps, allowlists, limits)
5. metering + post-call reconciliation
6. dashboard + exports
7. trust-tiered provider onboarding

## trust tiers
- tier 0: community-listed (discoverable only)
- tier 1: metadata-verified
- tier 2: broker-enabled
- tier 3: recommended

## launch providers
- openai
- anthropic
- stripe
- resend
- twilio

## budget semantics
- soft alerts at 50/80/95%
- hard cap: allow in-flight call to finish, block next step

## key entities
- Workspace, Member, Role
- Project, Agent
- Provider, ProviderEndpoint, ProviderTier
- Credential (encrypted)
- Policy (monthly/per-run/burst)
- BrokerCall, SpendEvent, ReconciliationRecord

## nfr targets
- policy decision p95 < 50ms
- broker availability >= 99% (healthy dependency windows)
- reconciliation drift < 2%
- zero raw secret exfil paths

## success metrics (first 60 days)
- time to first successful call < 10 min
- zero hard-cap overruns
- >= 70% WAU connect 2+ providers
- failed call rate < 5% on stable providers
