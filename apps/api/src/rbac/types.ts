export type Role = 'owner' | 'admin' | 'dev' | 'viewer'

export const ROLE_WEIGHT: Record<Role, number> = {
  owner: 4,
  admin: 3,
  dev: 2,
  viewer: 1
}

export interface Workspace {
  id: string
  name: string
  createdAt: string
}

export interface Membership {
  workspaceId: string
  userId: string
  role: Role
  createdAt: string
}

export interface Invite {
  token: string
  workspaceId: string
  email: string
  role: Role
  invitedBy: string
  createdAt: string
  acceptedAt?: string
  acceptedBy?: string
}
