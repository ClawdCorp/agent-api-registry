export interface UsageInfo {
  costCents: number
  units?: Record<string, number>
  costDescription?: string
}

export interface ProviderAdapter {
  id: string
  name: string
  category: 'ai' | 'payments' | 'email' | 'communications'
  baseUrl: string
  description: string
  docsUrl: string
  authPattern: {
    type: 'bearer' | 'basic' | 'header'
    headerName?: string
  }
  buildOutboundHeaders(
    inboundHeaders: Record<string, string | string[] | undefined>,
    providerApiKey: string
  ): Record<string, string>
  extractUsage(
    method: string,
    path: string,
    requestBody: unknown,
    responseStatus: number,
    responseBody: unknown
  ): UsageInfo | null
  validateKeyFormat(key: string): boolean
  blockedPatterns?: RegExp[]
}
