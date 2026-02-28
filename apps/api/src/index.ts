import Fastify from 'fastify'
import authPlugin from './plugins/auth.js'
import proxyPlugin from './plugins/proxy.js'
import providerRoutes from './routes/providers.js'
import accountRoutes from './routes/account.js'
import spendRoutes from './routes/spend.js'
import adminRoutes from './routes/admin.js'
import creditRoutes from './routes/credits.js'
import playbookRoutes from './routes/playbooks.js'
import webhookRoutes from './routes/webhooks.js'
import { getDb } from './db/client.js'

const app = Fastify({ logger: true, bodyLimit: 1_048_576 })

// initialize database on startup
getDb()

// webhooks (registered before auth — signature-verified, not token-authenticated)
await app.register(webhookRoutes)

// plugins
await app.register(authPlugin)

// routes (must register before proxy to take priority)
await app.register(providerRoutes)
await app.register(accountRoutes)
await app.register(spendRoutes)
await app.register(adminRoutes)
await app.register(creditRoutes)
await app.register(playbookRoutes)

// health check (public)
app.get('/health', async () => ({ ok: true, service: 'aar-api', version: '0.1.0' }))

// transparent proxy (must be last — wildcard route)
await app.register(proxyPlugin)

const port = Number(process.env.PORT ?? 4000)
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`aar api listening on :${port}`))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
