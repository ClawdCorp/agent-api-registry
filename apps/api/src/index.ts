import Fastify from 'fastify'

const app = Fastify({ logger: true })

app.get('/health', async () => ({ ok: true, service: 'api' }))

app.get('/v1/providers', async () => ({
  data: [
    { id: 'openai', tier: 2 },
    { id: 'anthropic', tier: 2 },
    { id: 'stripe', tier: 2 },
    { id: 'resend', tier: 2 },
    { id: 'twilio', tier: 2 }
  ]
}))

const port = Number(process.env.PORT ?? 4000)
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`api listening on :${port}`))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
