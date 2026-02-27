export type Provider = { id: string; tier: number }

export class AgentApiRegistryClient {
  private signingSecret?: string
  
  constructor(private baseUrl: string, private token?: string, options?: { signingSecret?: string }) {
    this.signingSecret = options?.signingSecret
  }

  async listProviders(): Promise<Provider[]> {
    const res = await fetch(`${this.baseUrl}/v1/providers`, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined
    })
    if (!res.ok) throw new Error(`listProviders failed: ${res.status}`)
    const json = await res.json() as { data: Provider[] }
    return json.data
  }

  /**
   * Make a signed request to the broker API
   * Automatically adds signature headers for replay protection
   */
  async signedRequest(
    method: string,
    path: string,
    body?: object
  ): Promise<Response> {
    if (!this.signingSecret) {
      throw new Error('signingSecret required for signed requests')
    }
    
    const { signRequest } = await import('./signing')
    const bodyStr = body ? JSON.stringify(body) : undefined
    const signed = signRequest(this.signingSecret, method, path, bodyStr)
    
    const headers: Record<string, string> = {
      'x-signature': signed['x-signature'],
      'x-timestamp': signed['x-timestamp'],
      'x-nonce': signed['x-nonce'],
      'Content-Type': 'application/json'
    }
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }
    
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: bodyStr
    })
  }
}

// Export signing utilities
export {
  generateSignature,
  signRequest,
  verifyRequest,
  verifyRequestWithNonce,
  NonceStore,
  type SignedRequest,
  type VerificationResult
} from './signing'
