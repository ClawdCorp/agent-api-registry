import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'

function getMasterKey(): Buffer {
  const key = process.env.AAR_MASTER_KEY
  if (!key) throw new Error('AAR_MASTER_KEY env var is required')
  const buf = Buffer.from(key, 'hex')
  if (buf.length !== 32) throw new Error('AAR_MASTER_KEY must be 64 hex chars (32 bytes)')
  return buf
}

export function encrypt(plaintext: string): { encrypted: string; iv: string } {
  const key = getMasterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return {
    encrypted: encrypted + ':' + authTag,
    iv: iv.toString('hex')
  }
}

export function decrypt(encrypted: string, iv: string): string {
  const key = getMasterKey()
  const [ciphertext, authTag] = encrypted.split(':')
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(authTag, 'hex'))
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
