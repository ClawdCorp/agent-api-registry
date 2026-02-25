# monorepo starter

## structure
- `apps/api` fastify api service
- `apps/web` next.js frontend
- `packages/sdk` typed sdk client

## quickstart
```bash
pnpm install
pnpm dev:api
pnpm dev:web
```

## first endpoints
- `GET /health`
- `GET /v1/providers`
