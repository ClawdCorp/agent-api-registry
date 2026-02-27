import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { ROLE_WEIGHT, type Role } from '../rbac/types.js'
import { rbacStore } from '../rbac/store.js'

declare module 'fastify' {
  interface FastifyRequest {
    actorUserId?: string
    actorEmail?: string
    workspaceId?: string
    actorRole?: Role
  }
  interface FastifyInstance {
    requireRole: (minimum: Role) => (request: any) => Promise<void>
  }
}

const rbacPlugin: FastifyPluginAsync = async (app) => {
  app.decorate('requireRole', (minimum: Role) => {
    return async (request: FastifyRequest) => {
      const workspaceId = request.workspaceId
      const userId = request.actorUserId

      if (!workspaceId || !userId) {
        const err = new Error('workspace and actor context required') as Error & { statusCode?: number }
        err.statusCode = 401
        throw err
      }

      const membership = rbacStore.getMembership(workspaceId, userId)
      if (!membership) {
        const err = new Error('no membership in workspace') as Error & { statusCode?: number }
        err.statusCode = 403
        throw err
      }

      if (ROLE_WEIGHT[membership.role] < ROLE_WEIGHT[minimum]) {
        const err = new Error(`requires ${minimum} role or higher`) as Error & { statusCode?: number }
        err.statusCode = 403
        throw err
      }

      request.actorRole = membership.role
    }
  })

  app.addHook('preHandler', async (request) => {
    const workspaceId = (request.headers['x-workspace-id'] as string | undefined) ?? undefined
    const actorUserId = (request.headers['x-user-id'] as string | undefined) ?? undefined

    request.workspaceId = request.workspaceId ?? workspaceId
    request.actorUserId = request.actorUserId ?? actorUserId
  })
}

export default fp(rbacPlugin, { name: 'rbac-plugin' })
