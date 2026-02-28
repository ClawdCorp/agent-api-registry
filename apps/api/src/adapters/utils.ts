const BLOCKED_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'host',
  'connection',
  'transfer-encoding',
  'content-length',
])

export function filterSafeHeaders(
  inbound: Record<string, string | string[] | undefined>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(inbound)) {
    if (BLOCKED_HEADERS.has(key.toLowerCase())) continue
    if (value === undefined) continue
    out[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return out
}
