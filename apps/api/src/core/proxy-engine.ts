import { getAdapter } from '../adapters/index.js'
import type { UsageInfo } from '../adapters/types.js'
import { logSpendEvent } from './spend.js'
import { checkAndAlertThresholds } from './budget.js'
import { selectPlatformKey, recordKeyUsage, PlatformKeyError } from './platform-keys.js'

// ── Public interfaces ──────────────────────────────────────────────

export interface ProxyRequest {
  provider: string
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

export type KeySource =
  | { type: 'platform' }
  | { type: 'provided'; key: string }

export interface ProxyResponse {
  status: number
  headers: Record<string, string>
  body: unknown
  contentType: string
  usage: UsageInfo | null
  latencyMs: number
}

// ── Error types ────────────────────────────────────────────────────

export class ProxyEngineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'ProxyEngineError'
  }
}

// ── Engine ─────────────────────────────────────────────────────────

export class ProxyEngine {
  /**
   * Execute a proxied API call to a provider.
   *
   * Resolves the adapter, validates the request, makes the outbound
   * fetch, meters usage, and returns a plain ProxyResponse.
   */
  async execute(
    request: ProxyRequest,
    keySource: KeySource,
    accountId: string,
  ): Promise<ProxyResponse> {
    // 1. Resolve adapter
    const adapter = getAdapter(request.provider)
    if (!adapter) {
      throw new ProxyEngineError(
        `unknown provider: ${request.provider}`,
        'provider_not_found',
        404,
      )
    }

    // 2. Check blocked patterns
    if (adapter.blockedPatterns) {
      const reqLine = `${request.method} /${request.path}`
      for (const pattern of adapter.blockedPatterns) {
        if (pattern.test(reqLine)) {
          throw new ProxyEngineError(
            `this endpoint is blocked for safety: ${request.method} /${request.path}`,
            'blocked_endpoint',
            403,
          )
        }
      }
    }

    // 3. Resolve API key
    let apiKey: string
    let platformKeyId: string | undefined
    if (keySource.type === 'provided') {
      apiKey = keySource.key
    } else {
      // platform-managed keys — least-loaded routing
      try {
        const selected = selectPlatformKey(request.provider)
        apiKey = selected.apiKey
        platformKeyId = selected.keyId
      } catch (err) {
        if (err instanceof PlatformKeyError) {
          throw new ProxyEngineError(err.message, err.code, err.statusCode)
        }
        throw err
      }
    }

    // 4. Build outbound headers
    const targetUrl = `${adapter.baseUrl}/${request.path}`
    const outboundHeaders = adapter.buildOutboundHeaders(request.headers, apiKey)

    // Ensure content-type is forwarded
    if (request.headers['content-type'] && !outboundHeaders['content-type']) {
      const ct = request.headers['content-type']
      outboundHeaders['content-type'] = Array.isArray(ct) ? ct[0] : ct
    }

    // 5. Make fetch request
    const startMs = Date.now()

    try {
      const fetchOptions: RequestInit = {
        method: request.method,
        headers: outboundHeaders,
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const rawBody = request.body
        fetchOptions.body =
          typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)
      }

      const providerRes = await fetch(targetUrl, fetchOptions)
      const latencyMs = Date.now() - startMs

      // Read response body
      const contentType = providerRes.headers.get('content-type') ?? ''
      let responseBody: unknown
      if (contentType.includes('application/json')) {
        responseBody = await providerRes.json()
      } else {
        responseBody = await providerRes.text()
      }

      // 6. Extract usage
      const usage = adapter.extractUsage(
        request.method,
        `/${request.path}`,
        request.body,
        providerRes.status,
        responseBody,
      )

      // 7. Log spend event
      logSpendEvent({
        accountId,
        provider: request.provider,
        method: request.method,
        endpoint: `/${request.path}`,
        costCents: usage?.costCents ?? 0,
        responseStatus: providerRes.status,
        latencyMs,
      })

      // 8. Record platform key usage
      if (platformKeyId) {
        recordKeyUsage(platformKeyId)
      }

      // 9. Check budget alerts
      checkAndAlertThresholds(accountId)

      // 10. Build safe response headers
      const responseHeaders: Record<string, string> = {}
      const skipHeaders = new Set([
        'transfer-encoding',
        'connection',
        'content-encoding',
        'content-length',
      ])
      for (const [key, value] of providerRes.headers.entries()) {
        if (!skipHeaders.has(key.toLowerCase())) {
          responseHeaders[key] = value
        }
      }

      return {
        status: providerRes.status,
        headers: responseHeaders,
        body: responseBody,
        contentType,
        usage,
        latencyMs,
      }
    } catch (err) {
      const latencyMs = Date.now() - startMs

      // If it's already a ProxyEngineError, rethrow
      if (err instanceof ProxyEngineError) {
        throw err
      }

      // Log failed call
      logSpendEvent({
        accountId,
        provider: request.provider,
        method: request.method,
        endpoint: `/${request.path}`,
        costCents: 0,
        responseStatus: 502,
        latencyMs,
      })

      const message = err instanceof Error ? err.message : 'unknown error'
      throw new ProxyEngineError(
        `failed to reach ${request.provider}: ${message}`,
        'proxy_error',
        502,
      )
    }
  }
}
