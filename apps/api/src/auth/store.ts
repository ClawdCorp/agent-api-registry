import crypto from 'node:crypto'

export interface User {
  id: string
  email: string
  name?: string
  createdAt: string
}

export interface Session {
  id: string
  token: string
  userId: string
  createdAt: string
  expiresAt: string
  revokedAt?: string
}

export interface MachineToken {
  id: string
  token: string
  workspaceId: string
  label: string
  createdBy: string
  createdAt: string
  revokedAt?: string
}

class AuthStore {
  private usersByEmail = new Map<string, User>()
  private sessionsByToken = new Map<string, Session>()
  private machineTokensByToken = new Map<string, MachineToken>()
  private machineTokensById = new Map<string, MachineToken>()

  getOrCreateUser(email: string, name?: string): User {
    const key = email.trim().toLowerCase()
    const existing = this.usersByEmail.get(key)
    if (existing) return existing

    const user: User = {
      id: `usr_${crypto.randomUUID().slice(0, 10)}`,
      email: key,
      name,
      createdAt: new Date().toISOString()
    }
    this.usersByEmail.set(key, user)
    return user
  }

  createSession(userId: string, ttlHours = 24): Session {
    const now = Date.now()
    const session: Session = {
      id: `ses_${crypto.randomUUID().slice(0, 10)}`,
      token: `st_${crypto.randomBytes(24).toString('hex')}`,
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlHours * 60 * 60 * 1000).toISOString()
    }
    this.sessionsByToken.set(session.token, session)
    return session
  }

  getSession(token: string): Session | null {
    const s = this.sessionsByToken.get(token)
    if (!s || s.revokedAt) return null
    if (Date.parse(s.expiresAt) <= Date.now()) return null
    return s
  }

  revokeSession(token: string): boolean {
    const s = this.sessionsByToken.get(token)
    if (!s || s.revokedAt) return false
    s.revokedAt = new Date().toISOString()
    return true
  }

  createMachineToken(workspaceId: string, label: string, createdBy: string): MachineToken {
    const mt: MachineToken = {
      id: `mtk_${crypto.randomUUID().slice(0, 10)}`,
      token: `mt_${crypto.randomBytes(24).toString('hex')}`,
      workspaceId,
      label,
      createdBy,
      createdAt: new Date().toISOString()
    }
    this.machineTokensByToken.set(mt.token, mt)
    this.machineTokensById.set(mt.id, mt)
    return mt
  }

  getMachineToken(token: string): MachineToken | null {
    const mt = this.machineTokensByToken.get(token)
    if (!mt || mt.revokedAt) return null
    return mt
  }

  listMachineTokens(workspaceId: string): Array<Omit<MachineToken, 'token'>> {
    return [...this.machineTokensById.values()]
      .filter(t => t.workspaceId === workspaceId)
      .map(({ token: _token, ...rest }) => rest)
  }

  revokeMachineToken(id: string): boolean {
    const mt = this.machineTokensById.get(id)
    if (!mt || mt.revokedAt) return false
    mt.revokedAt = new Date().toISOString()
    return true
  }
}

export const authStore = new AuthStore()
