export type Provider = { id: string; tier: number }

export class AgentApiRegistryClient {
  constructor(private baseUrl: string, private token?: string) {}

  async listProviders(): Promise<Provider[]> {
    const res = await fetch(`${this.baseUrl}/v1/providers`, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined
    })
    if (!res.ok) throw new Error(`listProviders failed: ${res.status}`)
    const json = await res.json() as { data: Provider[] }
    return json.data
  }
}
