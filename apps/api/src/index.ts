import Fastify from 'fastify'
import authPlugin from './plugins/auth.js'
import proxyPlugin from './plugins/proxy.js'
import providerRoutes from './routes/providers.js'
import accountRoutes from './routes/account.js'
import spendRoutes from './routes/spend.js'
import { getDb } from './db/client.js'

const app = Fastify({ logger: true })

// initialize database on startup
getDb()

// plugins
await app.register(authPlugin)

// routes (must register before proxy to take priority)
await app.register(providerRoutes)
await app.register(accountRoutes)
await app.register(spendRoutes)

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
