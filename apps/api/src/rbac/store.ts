import crypto from 'node:crypto'
import type { Invite, Membership, Role, Workspace } from './types.js'

class RbacStore {
  private workspaces = new Map<string, Workspace>()
  private memberships = new Map<string, Membership>() // key: workspaceId:userId
  private invites = new Map<string, Invite>()

  createWorkspace(name: string, ownerUserId: string): Workspace {
    const id = `ws_${crypto.randomUUID().slice(0, 8)}`
    const workspace: Workspace = { id, name, createdAt: new Date().toISOString() }
    this.workspaces.set(id, workspace)
    this.setMembership(id, ownerUserId, 'owner')
    return workspace
  }

  getWorkspace(id: string): Workspace | null {
    return this.workspaces.get(id) ?? null
  }

  setMembership(workspaceId: string, userId: string, role: Role): Membership {
    const membership: Membership = {
      workspaceId,
      userId,
      role,
      createdAt: new Date().toISOString()
    }
    this.memberships.set(`${workspaceId}:${userId}`, membership)
    return membership
  }

  getMembership(workspaceId: string, userId: string): Membership | null {
    return this.memberships.get(`${workspaceId}:${userId}`) ?? null
  }

  listMembers(workspaceId: string): Membership[] {
    return [...this.memberships.values()].filter(m => m.workspaceId === workspaceId)
  }

  createInvite(workspaceId: string, email: string, role: Role, invitedBy: string): Invite {
    const token = crypto.randomBytes(24).toString('hex')
    const invite: Invite = {
      token,
      workspaceId,
      email,
      role,
      invitedBy,
      createdAt: new Date().toISOString()
    }
    this.invites.set(token, invite)
    return invite
  }

  acceptInvite(token: string, userId: string): Invite | null {
    const invite = this.invites.get(token)
    if (!invite || invite.acceptedAt) return null

    invite.acceptedAt = new Date().toISOString()
    invite.acceptedBy = userId
    this.setMembership(invite.workspaceId, userId, invite.role)
    return invite
  }

  getInvite(token: string): Invite | null {
    return this.invites.get(token) ?? null
  }
}

export const rbacStore = new RbacStore()
