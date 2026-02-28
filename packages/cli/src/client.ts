const DEFAULT_API_URL = 'http://localhost:4000'

export function getConfig(): { apiUrl: string; apiKey: string } {
  const apiUrl = process.env.AAR_API_URL ?? DEFAULT_API_URL
  const apiKey = process.env.AAR_API_KEY ?? ''
  if (!apiKey) {
    console.error('Error: AAR_API_KEY environment variable is required')
    console.error('Set it with: export AAR_API_KEY=aar_sk_...')
    process.exit(1)
  }
  return { apiUrl, apiKey }
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const { apiUrl, apiKey } = getConfig()
  const url = `${apiUrl}${path}`
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json() as any
  if (!res.ok) {
    console.error(`Error (${res.status}): ${data.message ?? data.error ?? 'unknown error'}`)
    process.exit(1)
  }
  return data as T
}
