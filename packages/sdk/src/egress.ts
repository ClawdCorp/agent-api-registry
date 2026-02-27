/**
 * Egress Allowlist Enforcement
 * 
 * Ensures broker only makes outbound requests to approved provider domains.
 * Prevents SSRF attacks and unauthorized API calls.
 */

export interface AllowedEndpoint {
  /** Provider ID (e.g., 'openai', 'stripe') */
  provider: string
  /** Allowed hostnames (exact match or suffix match with wildcard) */
  hostnames: string[]
  /** Whether to allow subdomains */
  allowSubdomains?: boolean
  /** Required protocol(s) */
  protocols?: ('http:' | 'https:')[]
  /** Optional path prefix restrictions */
  pathPrefix?: string
}

interface ValidationResult {
  allowed: boolean
  reason?: string
  matchedProvider?: string
}

/**
 * Default allowlist for launch providers
 */
export const DEFAULT_ALLOWLIST: AllowedEndpoint[] = [
  {
    provider: 'openai',
    hostnames: ['api.openai.com'],
    protocols: ['https:'],
    allowSubdomains: false
  },
  {
    provider: 'anthropic',
    hostnames: ['api.anthropic.com'],
    protocols: ['https:'],
    allowSubdomains: false
  },
  {
    provider: 'stripe',
    hostnames: ['api.stripe.com'],
    protocols: ['https:'],
    allowSubdomains: false
  },
  {
    provider: 'resend',
    hostnames: ['api.resend.com'],
    protocols: ['https:'],
    allowSubdomains: false
  },
  {
    provider: 'twilio',
    hostnames: ['api.twilio.com'],
    protocols: ['https:'],
    allowSubdomains: false
  }
]

/**
 * Validates if a URL is in the allowlist
 */
export function validateEgress(
  url: string | URL,
  allowlist: AllowedEndpoint[] = DEFAULT_ALLOWLIST
): ValidationResult {
  let parsed: URL
  
  try {
    parsed = typeof url === 'string' ? new URL(url) : url
  } catch {
    return { allowed: false, reason: 'invalid_url' }
  }

  // Check protocol
  const protocol = parsed.protocol as 'http:' | 'https:'
  
  for (const endpoint of allowlist) {
    const protocols = endpoint.protocols ?? ['https:']
    if (!protocols.includes(protocol)) {
      continue
    }

    // Check hostname match
    const hostname = parsed.hostname.toLowerCase()
    const isAllowedHost = endpoint.hostnames.some(allowed => {
      const allowedLower = allowed.toLowerCase()
      
      // Exact match
      if (hostname === allowedLower) {
        return true
      }
      
      // Subdomain wildcard match
      if (endpoint.allowSubdomains) {
        return hostname.endsWith('.' + allowedLower)
      }
      
      return false
    })

    if (isAllowedHost) {
      // Check path prefix if specified
      if (endpoint.pathPrefix && !parsed.pathname.startsWith(endpoint.pathPrefix)) {
        continue
      }

      return { 
        allowed: true, 
        matchedProvider: endpoint.provider 
      }
    }
  }

  return { 
    allowed: false, 
    reason: 'host_not_in_allowlist',
    matchedProvider: undefined
  }
}

/**
 * Strict validation - rejects all private/internal IPs and localhost
 * Use this for production broker to prevent SSRF
 */
export function validateEgressStrict(
  url: string | URL,
  allowlist: AllowedEndpoint[] = DEFAULT_ALLOWLIST
): ValidationResult {
  const result = validateEgress(url, allowlist)
  if (!result.allowed) {
    return result
  }

  let parsed: URL
  try {
    parsed = typeof url === 'string' ? new URL(url) : url
  } catch {
    return { allowed: false, reason: 'invalid_url' }
  }

  const hostname = parsed.hostname.toLowerCase()

  // Block localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return { allowed: false, reason: 'localhost_blocked' }
  }

  // Block private IP ranges
  if (isPrivateIP(hostname)) {
    return { allowed: false, reason: 'private_ip_blocked' }
  }

  // Block common internal hostnames
  const blockedPatterns = [
    /^\d+\.\d+\.\d+\.\d+$/, // raw IPs (should use hostnames)
    /\.internal$/,
    /\.local$/,
    /\.cluster\.local$/,
    /^metadata\.google\.internal$/,
    /^169\.254\./, // link-local
  ]

  if (blockedPatterns.some(p => p.test(hostname))) {
    return { allowed: false, reason: 'internal_host_blocked' }
  }

  return result
}

/**
 * Create a fetch wrapper that enforces allowlist
 */
export function createAllowedFetch(
  allowlist: AllowedEndpoint[],
  options?: { strict?: boolean; onBlock?: (url: string, reason: string) => void }
): typeof fetch {
  const validate = options?.strict ? validateEgressStrict : validateEgress
  
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString()
    const result = validate(url, allowlist)
    
    if (!result.allowed) {
      options?.onBlock?.(url, result.reason!)
      throw new EgressBlockedError(url, result.reason!)
    }
    
    return fetch(input, init)
  }
}

/**
 * Error thrown when egress is blocked
 */
export class EgressBlockedError extends Error {
  constructor(
    public readonly url: string,
    public readonly reason: string
  ) {
    super(`Egress blocked: ${reason} - ${url}`)
    this.name = 'EgressBlockedError'
  }
}

// --- Utilities ---

function isPrivateIP(hostname: string): boolean {
  // Simple IPv4 private range check
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^127\./,
    /^0\./,
    /^169\.254\./
  ]
  
  return privateRanges.some(r => r.test(hostname))
}

/**
 * Load allowlist from workspace configuration
 * In production, fetch from database
 */
export async function loadWorkspaceAllowlist(
  workspaceId: string,
  fetchConfig: (id: string) => Promise<AllowedEndpoint[] | null>
): Promise<AllowedEndpoint[]> {
  const custom = await fetchConfig(workspaceId)
  if (custom && custom.length > 0) {
    return [...DEFAULT_ALLOWLIST, ...custom]
  }
  return DEFAULT_ALLOWLIST
}
