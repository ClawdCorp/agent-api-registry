/**
 * Request Signing + Replay Protection
 * 
 * Implements HMAC-SHA256 request signing with timestamp + nonce validation
 * to prevent replay attacks and ensure request authenticity.
 */

export interface SignedRequest {
  'x-signature': string
  'x-timestamp': string
  'x-nonce': string
}

interface VerifyOptions {
  /** Maximum age of request in seconds (default: 300 = 5 min) */
  maxAgeSeconds?: number
  /** Clock skew tolerance in seconds (default: 30) */
  clockSkewSeconds?: number
}

export interface VerificationResult {
  valid: boolean
  error?: string
}

/**
 * Generate HMAC-SHA256 signature for request
 */
export function generateSignature(
  secret: string,
  method: string,
  path: string,
  body: string | undefined,
  timestamp: string,
  nonce: string
): string {
  const crypto = require('crypto')
  const payload = `${method}|${path}|${body ?? ''}|${timestamp}|${nonce}`
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
}

/**
 * Generate signed request headers
 */
export function signRequest(
  secret: string,
  method: string,
  path: string,
  body?: string
): SignedRequest & { signature: string; timestamp: number; nonce: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = generateNonce()
  const signature = generateSignature(secret, method, path, body, timestamp, nonce)
  
  return {
    'x-signature': signature,
    'x-timestamp': timestamp,
    'x-nonce': nonce,
    signature, // raw values for internal use
    timestamp: parseInt(timestamp),
    nonce
  }
}

/**
 * Verify request signature and replay constraints
 */
export function verifyRequest(
  secret: string,
  method: string,
  path: string,
  body: string | undefined,
  headers: SignedRequest,
  options: VerifyOptions = {}
): VerificationResult {
  const { maxAgeSeconds = 300, clockSkewSeconds = 30 } = options
  
  const signature = headers['x-signature']
  const timestamp = headers['x-timestamp']
  const nonce = headers['x-nonce']
  
  // Check all required headers present
  if (!signature || !timestamp || !nonce) {
    return { valid: false, error: 'missing_signature_headers' }
  }
  
  // Validate timestamp format
  const ts = parseInt(timestamp)
  if (isNaN(ts)) {
    return { valid: false, error: 'invalid_timestamp' }
  }
  
  // Check timestamp is within acceptable window
  const now = Math.floor(Date.now() / 1000)
  const age = now - ts
  const maxAge = maxAgeSeconds + clockSkewSeconds
  
  if (age > maxAge) {
    return { valid: false, error: 'request_expired' }
  }
  
  if (age < -clockSkewSeconds) {
    return { valid: false, error: 'timestamp_in_future' }
  }
  
  // Verify signature
  const expected = generateSignature(secret, method, path, body, timestamp, nonce)
  if (!timingSafeEqual(signature, expected)) {
    return { valid: false, error: 'invalid_signature' }
  }
  
  return { valid: true }
}

/**
 * Nonce store for replay detection
 * In production, use Redis with TTL
 */
export class NonceStore {
  private nonces = new Map<string, number>()
  private maxAgeMs: number
  
  constructor(maxAgeSeconds = 600) {
    this.maxAgeMs = maxAgeSeconds * 1000
    // Periodic cleanup
    setInterval(() => this.cleanup(), 60000)
  }
  
  /**
   * Check if nonce has been used and record it
   */
  checkAndRecord(nonce: string): boolean {
    const now = Date.now()
    const existing = this.nonces.get(nonce)
    
    if (existing && (now - existing) < this.maxAgeMs) {
      return false // Nonce replay detected
    }
    
    this.nonces.set(nonce, now)
    return true
  }
  
  /**
   * Check nonce without recording (for verification)
   */
  has(nonce: string): boolean {
    const now = Date.now()
    const existing = this.nonces.get(nonce)
    return !!existing && (now - existing) < this.maxAgeMs
  }
  
  private cleanup(): void {
    const now = Date.now()
    for (const [nonce, timestamp] of this.nonces.entries()) {
      if (now - timestamp > this.maxAgeMs) {
        this.nonces.delete(nonce)
      }
    }
  }
  
  /** Get store size (for monitoring) */
  size(): number {
    return this.nonces.size
  }
  
  /** Clear all nonces (for testing) */
  clear(): void {
    this.nonces.clear()
  }
}

/**
 * Combined verification with nonce checking
 */
export function verifyRequestWithNonce(
  secret: string,
  method: string,
  path: string,
  body: string | undefined,
  headers: SignedRequest,
  nonceStore: NonceStore,
  options?: VerifyOptions
): VerificationResult {
  // First verify signature + timestamp
  const sigResult = verifyRequest(secret, method, path, body, headers, options)
  if (!sigResult.valid) {
    return sigResult
  }
  
  // Then check nonce
  const nonce = headers['x-nonce']
  if (!nonceStore.checkAndRecord(nonce)) {
    return { valid: false, error: 'nonce_replay' }
  }
  
  return { valid: true }
}

// --- Utilities ---

function generateNonce(): string {
  const crypto = require('crypto')
  return crypto.randomBytes(16).toString('hex')
}

function timingSafeEqual(a: string, b: string): boolean {
  const crypto = require('crypto')
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  
  if (bufA.length !== bufB.length) {
    // Still do comparison to avoid timing leak, but with wrong-length buffer
    crypto.timingSafeEqual(bufA, bufA)
    return false
  }
  
  return crypto.timingSafeEqual(bufA, bufB)
}
