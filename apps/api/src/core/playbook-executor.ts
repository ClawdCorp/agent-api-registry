import { randomUUID } from 'node:crypto'
import { getDb } from '../db/client.js'
import { ProxyEngine } from './proxy-engine.js'
import type { ProxyResponse } from './proxy-engine.js'
import { resolveTemplate, extractOutput } from './playbook-schema.js'
import { getAdapter } from '../adapters/index.js'
import type { PlaybookManifest, PlaybookStep } from './playbook-schema.js'
import { reserveCredits, consumeCredits, releaseReservation, getBalance } from './credits.js'
import type { CreditTransaction } from './credits.js'

// ── Public interfaces ──────────────────────────────────────────────

export interface ExecutionResult {
  executionId: string
  status: 'completed' | 'failed' | 'partial'
  output: Record<string, unknown> | null
  totalCostCents: number
  stepsCompleted: number
  stepsTotal: number
  error: string | null
  startedAt: string
  completedAt: string
}

export interface StepResult {
  stepId: string
  status: 'completed' | 'failed' | 'skipped'
  costCents: number
  latencyMs: number
  output: Record<string, unknown> | null
  error: string | null
}

// ── Execution context ──────────────────────────────────────────────

interface ExecutionContext {
  input: Record<string, unknown>
  steps: Record<string, Record<string, unknown>>
}

// ── Input defaults ────────────────────────────────────────────────

function applyInputDefaults(
  input: Record<string, unknown>,
  inputSchema: Record<string, unknown>,
): Record<string, unknown> {
  const properties = inputSchema.properties as
    | Record<string, { default?: unknown; type?: string }>
    | undefined
  if (!properties) return input

  const required = new Set(
    Array.isArray(inputSchema.required) ? (inputSchema.required as string[]) : [],
  )

  const result = { ...input }
  for (const [key, prop] of Object.entries(properties)) {
    if (result[key] === undefined) {
      if (prop?.default !== undefined) {
        result[key] = prop.default
      } else if (!required.has(key)) {
        // Safe zero-value for optional fields without explicit default (#67)
        const zeroValues: Record<string, unknown> = {
          string: '',
          number: 0,
          boolean: false,
        }
        if (prop?.type && prop.type in zeroValues) {
          result[key] = zeroValues[prop.type]
        }
      }
    }
  }
  return result
}

export class InputValidationError extends Error {
  public readonly fields: string[]
  constructor(fields: string[]) {
    super(`Missing required input fields: ${fields.join(', ')}`)
    this.name = 'InputValidationError'
    this.fields = fields
  }
}

function validateInput(
  input: Record<string, unknown>,
  inputSchema: Record<string, unknown>,
): void {
  const required = Array.isArray(inputSchema.required)
    ? (inputSchema.required as string[])
    : []
  const missing = required.filter((key) => input[key] === undefined || input[key] === null)
  if (missing.length > 0) {
    throw new InputValidationError(missing)
  }

  const properties = inputSchema.properties as
    | Record<string, { type?: string }>
    | undefined
  if (!properties) return

  const typeErrors: string[] = []
  for (const [key, prop] of Object.entries(properties)) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue
    if (!prop?.type) continue
    const actual = typeof input[key]
    if (prop.type === 'number' && actual !== 'number') {
      typeErrors.push(`${key}: expected number, got ${actual}`)
    } else if (prop.type === 'string' && actual !== 'string') {
      typeErrors.push(`${key}: expected string, got ${actual}`)
    } else if (prop.type === 'boolean' && actual !== 'boolean') {
      typeErrors.push(`${key}: expected boolean, got ${actual}`)
    }
  }
  if (typeErrors.length > 0) {
    throw new InputValidationError(typeErrors)
  }
}

// ── Executor ───────────────────────────────────────────────────────

export class PlaybookExecutor {
  private proxyEngine = new ProxyEngine()

  async execute(
    accountId: string,
    manifest: PlaybookManifest,
    input: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const executionId = `exec_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const startedAt = new Date().toISOString()
    const db = getDb()

    // 1. Apply input defaults from schema (#63)
    const resolvedInput = applyInputDefaults(input, manifest.inputSchema)

    // 1b. Validate required inputs before execution (#67)
    validateInput(resolvedInput, manifest.inputSchema)

    // 2. Reserve credits (skip for zero-cost playbooks) (#59)
    let reservationTxn: CreditTransaction | null = null

    if (manifest.estimatedCostCents.max > 0) {
      const balance = getBalance(accountId)
      if (balance < manifest.estimatedCostCents.max) {
        throw new Error(
          `Insufficient credit balance: have ${balance} cents, need ${manifest.estimatedCostCents.max} cents for playbook "${manifest.name}"`,
        )
      }
      reservationTxn = reserveCredits(
        accountId,
        manifest.estimatedCostCents.max,
        executionId,
      )
    }

    // 3. Insert execution record
    db.prepare(`
      INSERT INTO playbook_executions
        (id, account_id, playbook_id, playbook_version, status, input, steps_total, started_at, created_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)
    `).run(
      executionId,
      accountId,
      manifest.id,
      manifest.version,
      JSON.stringify(resolvedInput),
      manifest.steps.length,
      startedAt,
      startedAt,
    )

    // 4. Build execution context
    const context: ExecutionContext = { input: resolvedInput, steps: {} }

    // 5. Execute steps sequentially
    const stepResults: StepResult[] = []
    let totalCostCents = 0

    for (const step of manifest.steps) {
      const result = await this.executeStep(step, context, accountId)

      if (result.status === 'completed') {
        // Add extracted output to context for subsequent steps
        context.steps[step.id] = result.output ?? {}
        totalCostCents += result.costCents
        stepResults.push(result)

        // Update progress
        db.prepare(
          'UPDATE playbook_executions SET steps_completed = ? WHERE id = ?',
        ).run(
          stepResults.filter((s) => s.status === 'completed').length,
          executionId,
        )
        continue
      }

      // Step failed — check error strategy
      if (result.status === 'skipped') {
        context.steps[step.id] = {}
        stepResults.push(result)
        continue
      }

      // Step failed with onError === 'retry'
      if (step.onError === 'retry') {
        await delay(1000)
        const retryResult = await this.executeStep(step, context, accountId)

        if (retryResult.status === 'completed') {
          context.steps[step.id] = retryResult.output ?? {}
          totalCostCents += retryResult.costCents
          stepResults.push(retryResult)

          db.prepare(
            'UPDATE playbook_executions SET steps_completed = ? WHERE id = ?',
          ).run(
            stepResults.filter((s) => s.status === 'completed').length,
            executionId,
          )
          continue
        }

        // Retry also failed — abort
        stepResults.push(retryResult)
        break
      }

      // onError === 'fail' (default) — record and abort
      stepResults.push(result)
      break
    }

    // 6. Finalize
    const completedAt = new Date().toISOString()
    const allCompleted = stepResults.every(
      (s) => s.status === 'completed' || s.status === 'skipped',
    )
    const hasFailed = stepResults.some((s) => s.status === 'failed')
    const status: ExecutionResult['status'] = allCompleted
      ? 'completed'
      : hasFailed
        ? 'failed'
        : 'partial'

    // 7. Credit settlement (#61 — record failures instead of swallowing)
    let settlementStatus = 'settled'
    try {
      if (reservationTxn) {
        if (status === 'completed' || status === 'partial') {
          consumeCredits(reservationTxn.id, totalCostCents)
        } else {
          releaseReservation(reservationTxn.id)
        }
      }
      // Zero-cost playbooks: no reservation, nothing to settle
    } catch (settlementErr) {
      settlementStatus = 'failed'
    }

    // 8. Build final output
    const finalOutput =
      status === 'completed' ? (context.steps as Record<string, unknown>) : null

    const failedStep = hasFailed
      ? stepResults.find((s) => s.status === 'failed')
      : null
    let errorMessage: string | null = failedStep?.error ?? null

    if (settlementStatus === 'failed') {
      const settleMsg = 'credit settlement failed'
      errorMessage = errorMessage ? `${errorMessage}; ${settleMsg}` : settleMsg
    }

    // 9. Update execution record
    db.prepare(`
      UPDATE playbook_executions
      SET status = ?, output = ?, total_cost_cents = ?, credit_txn_id = ?,
          steps_completed = ?, error = ?, completed_at = ?, settlement_status = ?
      WHERE id = ?
    `).run(
      status,
      JSON.stringify({ steps: stepResults, output: finalOutput }),
      totalCostCents,
      reservationTxn?.id ?? null,
      stepResults.filter((s) => s.status === 'completed').length,
      errorMessage,
      completedAt,
      settlementStatus,
      executionId,
    )

    // 10. Return result
    return {
      executionId,
      status,
      output: finalOutput,
      totalCostCents,
      stepsCompleted: stepResults.filter((s) => s.status === 'completed').length,
      stepsTotal: manifest.steps.length,
      error: errorMessage,
      startedAt,
      completedAt,
    }
  }

  /**
   * Execute a single playbook step via the ProxyEngine.
   * Returns a StepResult — the caller decides how to handle failures.
   */
  private async executeStep(
    step: PlaybookStep,
    context: ExecutionContext,
    accountId: string,
  ): Promise<StepResult> {
    try {
      // Resolve body template
      const resolvedBody = resolveTemplate(step.bodyTemplate ?? {}, context)

      // Execute via ProxyEngine with platform keys
      const adapter = getAdapter(step.provider)
      const contentType = adapter?.contentType ?? 'application/json'
      const response: ProxyResponse = await this.proxyEngine.execute(
        {
          provider: step.provider,
          method: step.method,
          path: step.path,
          headers: { 'content-type': contentType },
          body: resolvedBody,
        },
        { type: 'platform' },
        accountId,
      )

      // Extract outputs
      const extracted = step.outputExtractor
        ? extractOutput(response.body, step.outputExtractor)
        : {}

      const stepCost = response.usage?.costCents ?? 0

      return {
        stepId: step.id,
        status: 'completed',
        costCents: stepCost,
        latencyMs: response.latencyMs,
        output: extracted,
        error: null,
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'unknown error'

      if (step.onError === 'skip') {
        return {
          stepId: step.id,
          status: 'skipped',
          costCents: 0,
          latencyMs: 0,
          output: null,
          error: errorMsg,
        }
      }

      return {
        stepId: step.id,
        status: 'failed',
        costCents: 0,
        latencyMs: 0,
        output: null,
        error: errorMsg,
      }
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
