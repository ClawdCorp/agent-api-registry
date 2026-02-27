import Fastify from 'fastify'
import signaturePlugin from './plugins/signature.js'
import rbacPlugin from './plugins/rbac.js'
import { rbacStore } from './rbac/store.js'
import type { Role } from './rbac/types.js'
import { authStore } from './auth/store.js'

const app = Fastify({ logger: true })

// mock secret store - replace with encrypted DB in CC-138
const secretStore = new Map<string, string>()

await app.register(rbacPlugin)
await app.register(signaturePlugin, {
  getSecret: async (workspaceId: string) => secretStore.get(workspaceId) ?? null,
  maxAgeSeconds: 300,
  clockSkewSeconds: 30,
  excludePaths: ['/health', '/v1/providers', '/v1/workspaces', '/v1/invites', '/internal/signature-stats']
})

// cc-137: auth/session + machine token context extraction
app.addHook('preHandler', async (req) => {
  const sessionToken = (req.headers['x-session-token'] as string | undefined) ?? undefined
  const machineToken = (req.headers['x-machine-token'] as string | undefined) ?? undefined

  if (sessionToken) {
    const session = authStore.getSession(sessionToken)
    if (session) {
      req.actorUserId = session.userId
    }
  }

  if (machineToken) {
    const mt = authStore.getMachineToken(machineToken)
    if (mt) {
      req.workspaceId = mt.workspaceId
      req.actorUserId = mt.createdBy
    }
  }
})

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

// cc-137: human auth/session bootstrap
app.post('/v1/auth/login', async (req, reply) => {
  const body = (req.body ?? {}) as { email?: string; name?: string }
  if (!body.email || !body.email.includes('@')) {
    return reply.code(400).send({ error: 'bad_request', message: 'valid email is required' })
  }

  const user = authStore.getOrCreateUser(body.email, body.name)
  const session = authStore.createSession(user.id, 24)

  return reply.code(201).send({
    user,
    session: {
      token: session.token,
      expiresAt: session.expiresAt
    }
  })
})

app.get('/v1/auth/me', async (req, reply) => {
  const sessionToken = (req.headers['x-session-token'] as string | undefined) ?? undefined
  if (!sessionToken) {
    return reply.code(401).send({ error: 'unauthorized', message: 'x-session-token is required' })
  }

  const session = authStore.getSession(sessionToken)
  if (!session) {
    return reply.code(401).send({ error: 'unauthorized', message: 'invalid or expired session' })
  }

  return { userId: session.userId, expiresAt: session.expiresAt }
})

app.post('/v1/auth/logout', async (req, reply) => {
  const sessionToken = (req.headers['x-session-token'] as string | undefined) ?? undefined
  if (!sessionToken) {
    return reply.code(401).send({ error: 'unauthorized', message: 'x-session-token is required' })
  }

  const ok = authStore.revokeSession(sessionToken)
  if (!ok) {
    return reply.code(404).send({ error: 'not_found', message: 'session not found' })
  }

  return { ok: true }
})

// cc-136: create workspace + owner membership
app.post('/v1/workspaces', async (req, reply) => {
  const body = (req.body ?? {}) as { name?: string }
  const ownerUserId = req.actorUserId

  if (!ownerUserId) {
    return reply.code(401).send({ error: 'unauthorized', message: 'x-user-id is required' })
  }

  if (!body.name || body.name.trim().length < 2) {
    return reply.code(400).send({ error: 'bad_request', message: 'name is required' })
  }

  const workspace = rbacStore.createWorkspace(body.name.trim(), ownerUserId)
  // bootstrap workspace signing secret for broker
  secretStore.set(workspace.id, `broker-secret-${workspace.id}`)

  return reply.code(201).send({
    workspace,
    membership: rbacStore.getMembership(workspace.id, ownerUserId)
  })
})

// cc-136: protected endpoint requiring viewer+
app.get('/v1/workspaces/:workspaceId/members', {
  preHandler: [async (req) => app.requireRole('viewer')(req)]
}, async (req, reply) => {
  const { workspaceId } = req.params as { workspaceId: string }

  // cross-workspace guardrail
  if (req.workspaceId !== workspaceId) {
    return reply.code(403).send({ error: 'forbidden', message: 'cross-workspace access denied' })
  }

  return { data: rbacStore.listMembers(workspaceId) }
})

// cc-136: invite flow (admin+ can invite)
app.post('/v1/workspaces/:workspaceId/invites', {
  preHandler: [async (req) => app.requireRole('admin')(req)]
}, async (req, reply) => {
  const { workspaceId } = req.params as { workspaceId: string }
  const body = (req.body ?? {}) as { email?: string; role?: Role }

  if (req.workspaceId !== workspaceId) {
    return reply.code(403).send({ error: 'forbidden', message: 'cross-workspace access denied' })
  }

  const role = body.role ?? 'viewer'
  if (!body.email || !['owner', 'admin', 'dev', 'viewer'].includes(role)) {
    return reply.code(400).send({ error: 'bad_request', message: 'email and valid role required' })
  }

  // prevent admin -> owner escalation via invite creation
  if (role === 'owner' && req.actorRole !== 'owner') {
    return reply.code(403).send({ error: 'forbidden', message: 'only owners can invite owners' })
  }

  const invite = rbacStore.createInvite(workspaceId, body.email, role, req.actorUserId!)
  return reply.code(201).send({ invite })
})

// cc-137: workspace-bound machine tokens (admin+)
app.post('/v1/workspaces/:workspaceId/tokens', {
  preHandler: [async (req) => app.requireRole('admin')(req)]
}, async (req, reply) => {
  const { workspaceId } = req.params as { workspaceId: string }
  const body = (req.body ?? {}) as { label?: string }

  if (req.workspaceId !== workspaceId) {
    return reply.code(403).send({ error: 'forbidden', message: 'cross-workspace access denied' })
  }

  const label = (body.label ?? 'machine-token').trim()
  const token = authStore.createMachineToken(workspaceId, label, req.actorUserId!)

  return reply.code(201).send({
    token: {
      id: token.id,
      token: token.token,
      workspaceId: token.workspaceId,
      label: token.label,
      createdBy: token.createdBy,
      createdAt: token.createdAt
    }
  })
})

app.get('/v1/workspaces/:workspaceId/tokens', {
  preHandler: [async (req) => app.requireRole('admin')(req)]
}, async (req, reply) => {
  const { workspaceId } = req.params as { workspaceId: string }

  if (req.workspaceId !== workspaceId) {
    return reply.code(403).send({ error: 'forbidden', message: 'cross-workspace access denied' })
  }

  return { data: authStore.listMachineTokens(workspaceId) }
})

app.post('/v1/workspaces/:workspaceId/tokens/:tokenId/revoke', {
  preHandler: [async (req) => app.requireRole('admin')(req)]
}, async (req, reply) => {
  const { workspaceId, tokenId } = req.params as { workspaceId: string; tokenId: string }

  if (req.workspaceId !== workspaceId) {
    return reply.code(403).send({ error: 'forbidden', message: 'cross-workspace access denied' })
  }

  const ok = authStore.revokeMachineToken(tokenId)
  if (!ok) {
    return reply.code(404).send({ error: 'not_found', message: 'token not found or already revoked' })
  }

  return { ok: true, tokenId }
})

// cc-136: accept invite creates membership
app.post('/v1/invites/:token/accept', async (req, reply) => {
  const actorUserId = req.actorUserId
  if (!actorUserId) {
    return reply.code(401).send({ error: 'unauthorized', message: 'x-user-id is required' })
  }

  const { token } = req.params as { token: string }
  const invite = rbacStore.acceptInvite(token, actorUserId)

  if (!invite) {
    return reply.code(404).send({ error: 'not_found', message: 'invite missing or already accepted' })
  }

  return {
    invite,
    membership: rbacStore.getMembership(invite.workspaceId, actorUserId)
  }
})

// broker endpoint (signature-validated)
app.post('/v1/broker/:provider/*', {
  preHandler: [async (req) => app.requireRole('dev')(req)]
}, async (req) => {
  const { provider } = req.params as { provider: string }
  return {
    ok: true,
    provider,
    workspaceId: req.workspaceId,
    actorRole: req.actorRole,
    signatureValid: true
  }
})

const port = Number(process.env.PORT ?? 4000)
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`api listening on :${port}`))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
