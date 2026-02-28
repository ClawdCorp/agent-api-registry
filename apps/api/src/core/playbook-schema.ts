import { z } from 'zod'
import { getAdapter } from '../adapters/index.js'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const PlaybookStepSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1),
  bodyTemplate: z.record(z.string(), z.unknown()).optional(),
  outputExtractor: z.record(z.string(), z.string()).optional(),
  onError: z.enum(['fail', 'skip', 'retry']).default('fail'),
})

export type PlaybookStep = z.infer<typeof PlaybookStepSchema>

export const PlaybookManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'must be semver'),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  author: z.string().min(1),
  industry: z.array(z.string()).min(1),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  steps: z.array(PlaybookStepSchema).min(1),
  estimatedCostCents: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }),
  providers: z.array(z.string()).min(1),
})

export type PlaybookManifest = z.infer<typeof PlaybookManifestSchema>

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Resolve mustache-style {{input.field}} and {{steps.stepId.field}} references
 * in a body template. Returns a new object with resolved values.
 */
export function resolveTemplate(
  template: unknown,
  context: {
    input: Record<string, unknown>
    steps: Record<string, Record<string, unknown>>
  },
): unknown {
  if (typeof template === 'string') {
    // Check for a full-string reference: the entire string is one {{...}} token
    const fullMatch = /^\{\{(.+?)\}\}$/.exec(template)
    if (fullMatch && !template.includes('}}{{')) {
      const resolved = resolveReference(fullMatch[1].trim(), context)
      return resolved
    }

    // Inline interpolation: replace each {{...}} within a larger string
    if (template.includes('{{')) {
      return template.replace(/\{\{(.+?)\}\}/g, (_match, ref: string) => {
        const resolved = resolveReference(ref.trim(), context)
        return String(resolved)
      })
    }

    return template
  }

  if (Array.isArray(template)) {
    return template.map((item) => resolveTemplate(item, context))
  }

  if (template !== null && typeof template === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(
      template as Record<string, unknown>,
    )) {
      result[key] = resolveTemplate(value, context)
    }
    return result
  }

  // Primitives (number, boolean, null) pass through unchanged
  return template
}

function resolveReference(
  ref: string,
  context: {
    input: Record<string, unknown>
    steps: Record<string, Record<string, unknown>>
  },
): unknown {
  if (ref.startsWith('input.')) {
    const path = ref.slice('input.'.length)
    const value = getNestedValue(context.input, path)
    if (value === undefined) {
      throw new Error(`Unresolved template reference: {{${ref}}}`)
    }
    return value
  }

  if (ref.startsWith('steps.')) {
    const path = ref.slice('steps.'.length)
    const value = getNestedValue(context.steps, path)
    if (value === undefined) {
      throw new Error(`Unresolved template reference: {{${ref}}}`)
    }
    return value
  }

  throw new Error(`Unresolved template reference: {{${ref}}}`)
}

// ---------------------------------------------------------------------------
// Output extraction
// ---------------------------------------------------------------------------

/**
 * Extract values from a response body using dot-notation paths.
 * e.g., { "content": "choices.0.message.content" } extracts response.choices[0].message.content
 */
export function extractOutput(
  responseBody: unknown,
  extractors: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, path] of Object.entries(extractors)) {
    result[key] = getNestedValue(responseBody, path)
  }
  return result
}

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

/**
 * Validate a manifest and check that all step providers exist in the adapters registry.
 */
export function validateManifest(
  manifest: unknown,
):
  | { success: true; data: PlaybookManifest }
  | { success: false; errors: string[] } {
  const parsed = PlaybookManifestSchema.safeParse(manifest)

  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    }
  }

  const errors: string[] = []
  const data = parsed.data

  // Check that each step's provider has a registered adapter
  for (const step of data.steps) {
    if (!getAdapter(step.provider)) {
      errors.push(
        `Step "${step.id}" references unknown provider "${step.provider}"`,
      )
    }
  }

  // Check that every provider listed in the manifest's providers array is known
  for (const provider of data.providers) {
    if (!getAdapter(provider)) {
      errors.push(`Unknown provider in providers array: "${provider}"`)
    }
  }

  // Check that the providers array matches the set of providers used in steps
  const stepProviders = new Set(data.steps.map((s) => s.provider))
  for (const sp of stepProviders) {
    if (!data.providers.includes(sp)) {
      errors.push(
        `Step provider "${sp}" is not listed in the manifest providers array`,
      )
    }
  }
  for (const mp of data.providers) {
    if (!stepProviders.has(mp)) {
      errors.push(
        `Manifest providers array includes "${mp}" but no step uses it`,
      )
    }
  }

  if (errors.length > 0) {
    return { success: false, errors }
  }

  return { success: true, data }
}
