# Test Flow

## Setup

### 1. Create `.env` in project root

```bash
AAR_MASTER_KEY=<run `openssl rand -hex 32` and paste here>

# Provider keys (add whichever you have)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
STRIPE_API_KEY=sk_test_...
RESEND_API_KEY=re_...
TWILIO_API_KEY=AC...:authtoken
```

### 2. Source env and seed

```bash
source .env
AAR_MASTER_KEY=$AAR_MASTER_KEY pnpm --filter @aar/api seed
```

Copy the `AAR_API_KEY` from the seed output and add it to your `.env`:

```bash
AAR_API_KEY=aar_sk_<from seed output>
```

Re-source:

```bash
source .env
```

### 3. Start the server

```bash
AAR_MASTER_KEY=$AAR_MASTER_KEY pnpm dev:api
```

## Test Commands

Run these in a second terminal after `source .env`.

### Health check

```bash
curl -s localhost:4000/health | jq
```

### List providers

```bash
# Public (no connected status)
curl -s localhost:4000/v1/providers | jq

# Authenticated (shows connected: true/false per provider)
curl -s localhost:4000/v1/providers \
  -H "Authorization: Bearer $AAR_API_KEY" | jq
```

### Account info

```bash
curl -s localhost:4000/v1/account \
  -H "Authorization: Bearer $AAR_API_KEY" | jq
```

### Add a provider key

```bash
curl -s -X POST localhost:4000/v1/account/providers/openai \
  -H "Authorization: Bearer $AAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$OPENAI_API_KEY\",\"label\":\"dev\"}" | jq
```

### Proxy a real call

```bash
curl -s localhost:4000/openai/v1/chat/completions \
  -H "Authorization: Bearer $AAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Say hello in 5 words"}]}' | jq
```

### Check spend

```bash
curl -s localhost:4000/v1/spend \
  -H "Authorization: Bearer $AAR_API_KEY" | jq
```

### Check budget

```bash
curl -s localhost:4000/v1/budget \
  -H "Authorization: Bearer $AAR_API_KEY" | jq
```

### Set budget and test hard cap

```bash
# Set budget to 1 cent
curl -s -X PUT localhost:4000/v1/account/budget \
  -H "Authorization: Bearer $AAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"monthly_budget_cents":1}' | jq

# This should return 429 budget_exceeded
curl -s localhost:4000/openai/v1/chat/completions \
  -H "Authorization: Bearer $AAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"blocked?"}]}' | jq

# Reset budget
curl -s -X PUT localhost:4000/v1/account/budget \
  -H "Authorization: Bearer $AAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"monthly_budget_cents":10000}' | jq
```

### Error cases

```bash
# Unknown provider
curl -s localhost:4000/fakeprovider/v1/test \
  -H "Authorization: Bearer $AAR_API_KEY" | jq

# No provider key configured
curl -s localhost:4000/stripe/v1/charges \
  -H "Authorization: Bearer $AAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' | jq

# No auth
curl -s localhost:4000/openai/v1/test | jq

# Bad auth
curl -s localhost:4000/v1/account \
  -H "Authorization: Bearer bad_key" | jq
```

### Create a new account via API

```bash
curl -s -X POST localhost:4000/v1/account \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","name":"Test User"}' | jq
```

### Revoke an API key

```bash
# List keys first
curl -s localhost:4000/v1/account \
  -H "Authorization: Bearer $AAR_API_KEY" | jq '.api_keys'

# Revoke by ID
curl -s -X DELETE localhost:4000/v1/account/keys/<key_id> \
  -H "Authorization: Bearer $AAR_API_KEY" | jq
```

### Remove a provider key

```bash
curl -s -X DELETE localhost:4000/v1/account/providers/openai \
  -H "Authorization: Bearer $AAR_API_KEY" | jq
```
