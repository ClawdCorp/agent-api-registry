/**
 * Fastify plugin for request signature validation
 * 
 * Adds middleware to verify HMAC signatures and prevent replay attacks
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { verifyRequestWithNonce, NonceStore } from '@aar/sdk'

interface SignaturePluginOptions {
  /** Get secret for workspace/agent */
  getSecret: (workspaceId: string, agentId?: string) => Promise<string | null>
  /** Max request age in seconds (default: 300) */
  maxAgeSeconds?: number
  /** Clock skew tolerance in seconds (default: 30) */
  clockSkewSeconds?: number
  /** Nonce TTL in seconds (default: 600) */
  nonceTtlSeconds?: number
  /** Paths to exclude from signature check */
  excludePaths?: string[]
}

// Shared nonce store across all routes
// In production, use Redis
const nonceStore = new NonceStore(600)

/**
 * Fastify plugin for request signature validation
 */
const signatureValidationPlugin: FastifyPluginAsync<SignaturePluginOptions> = async (
  fastify: FastifyInstance,
  opts: SignaturePluginOptions
) => {
  const {
    getSecret,
    maxAgeSeconds = 300,
    clockSkewSeconds = 30,
    excludePaths = ['/health', '/v1/providers']
  } = opts

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Enforce signatures only on broker routes
    if (!request.url.startsWith('/v1/broker/')) {
      return
    }

    // Skip excluded paths
    if (excludePaths.some(p => request.url.startsWith(p))) {
      return
    }

    // Extract workspace/agent from authenticated context
    // Assumes auth middleware has already run and set request.user
    const workspaceId = ((request as any).workspaceId || request.headers['x-workspace-id']) as string | undefined
    const agentId = (request as any).agentId
    
    if (!workspaceId) {
      reply.code(401).send({ error: 'unauthorized', message: 'Workspace context required' })
      return
    }

    // Get signing secret for this workspace/agent
    const secret = await getSecret(workspaceId, agentId)
    if (!secret) {
      reply.code(401).send({ error: 'unauthorized', message: 'Signing secret not found' })
      return
    }

    // Get signature headers
    const signature = request.headers['x-signature'] as string
    const timestamp = request.headers['x-timestamp'] as string
    const nonce = request.headers['x-nonce'] as string

    if (!signature || !timestamp || !nonce) {
      reply.code(401).send({ 
        error: 'missing_signature', 
        message: 'Required headers: x-signature, x-timestamp, x-nonce' 
      })
      return
    }

    // Read body for verification
    const body = request.body ? JSON.stringify(request.body) : undefined
    
    // Verify signature and nonce
    const result = verifyRequestWithNonce(
      secret,
      request.method,
      request.url,
      body,
      { 'x-signature': signature, 'x-timestamp': timestamp, 'x-nonce': nonce },
      nonceStore,
      { maxAgeSeconds, clockSkewSeconds }
    )

    if (!result.valid) {
      request.log.warn({ 
        error: result.error, 
        workspaceId, 
        path: request.url 
      }, 'signature verification failed')
      
      reply.code(401).send({ 
        error: result.error,
        message: 'Request signature invalid or expired' 
      })
      return
    }

    // Attach nonce store for potential manual checks
    ;(request as any).nonceStore = nonceStore
  })

  // Expose nonce store stats endpoint for monitoring
  fastify.get('/internal/signature-stats', async () => ({
    nonceStoreSize: nonceStore.size(),
    timestamp: new Date().toISOString()
  }))
}

export default fp(signatureValidationPlugin, { name: 'signature-validation' })

// Export for manual use in specific routes
export { nonceStore }
