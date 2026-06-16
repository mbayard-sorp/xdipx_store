/**
 * Lockstep batched orchestrator runner.
 *
 * Drives many products' tool-use loops together, one Anthropic Message Batch
 * per "turn". A poller cron calls advanceInflightJobs() every 2 minutes;
 * each call advances every queued/in-flight job by ONE pass (retrieve +
 * optionally submit next batch), fitting within Vercel's 60s budget.
 *
 * Key invariants (see spec Part C0.5):
 *  1. The batch runner always uses the API path (AnthropicSdkClient), NEVER
 *     ClaudeAgentSdkClient. llmClient is stripped from products JSONB before
 *     insert (it is a class instance, not JSON-serializable).
 *  2. Per-product tool execution inside advanceJob is SEQUENTIAL -- never
 *     Promise.all across products. Two hazards force this:
 *     - drainToolTokens() reads/resets a module-level accumulator in claude.server.ts.
 *       Concurrent executeTool calls would race token accounting.
 *     - generateSensationDialV2 -> appendDialLabel mutates state.dialRegistry and
 *       writes to Sanity; two products of the same type would corrupt each other.
 *  3. Shared taxonomy (dialRegistry/dialTaxonomy/vocab) is loaded once per
 *     advanceJob call but deep-copied into each product's stateFor() so mutations
 *     in product A do not leak into product B.
 *
 * Turn-counter semantics mirror the real loop exactly:
 *   - p.turns is incremented at SUBMIT time (pre-increment), gated on p.turns < max_turns.
 *   - A product that has submitted max_turns requests is dropped from the next batch.
 *   - This ensures at most max_turns (24) requests per product, never a 25th.
 */

import { randomUUID } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { eq, inArray } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { batchJobs } from '../../db/schema'
import type {
  BatchJobProduct,
  BatchJobProductResult,
  ProductRunnerState,
} from '../../db/schema'
import {
  TOOLS,
  SYSTEM,
  buildUserPrompt,
  executeTool,
  type OrchestratorState,
  assembleWrites,
} from '~/lib/emma-orchestrator.server'
import type { OrchestratorInput, OrchestratorTelemetry, ProductWrites } from '~/lib/emma-orchestrator.server'
import { getDialRegistry, getDialTaxonomy } from '~/lib/dial-registry.server'
import { getAskEmmaVocabulary } from '~/lib/ask-emma-vocab.server'
import { applyFullEnrichmentWrites } from '~/lib/import-enrich.server'
import { logApiTokens } from '~/lib/token-log.server'
import { kvSet, KV_KEYS } from '~/lib/kv.server'
import { drainToolTokens } from '~/lib/claude.server'
import { SONNET } from './models.server'

const MODEL = SONNET
const KV_TTL_SECONDS = 24 * 60 * 60 // 24h

// ─── Anthropic client (API path only) ────────────────────────────────────────

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnqueueBatchJobArgs {
  jobType:      'full-enrichment' | 'emma-take' | 'emma-hero' | 'regenerate' | 'field-regen'
  source:       'bulk-import' | 'import-product' | 'deal-manager' | 'backfill' | 'regenerate-keywords' | 'regen-fields' | 'regen-emma-hero' | 'regen-emma-take'
  /** OrchestratorInput per product. llmClient is stripped before insert. */
  products:     Array<{ productId: string; sku: string; input: OrchestratorInput }>
  gatesDealId?: number
  maxTurns?:    number
}

export interface BatchJobSummary {
  jobId:          string
  jobType:        string
  status:         string
  source:         string
  skuList:        string[]
  turn:           number
  maxTurns:       number
  currentBatchId: string | null
  gatesDealId:    number | null
  appliedSkus:    string[]
  createdAt:      Date
  updatedAt:      Date
  completedAt:    Date | null
  failedAt:       Date | null
  results:        BatchJobProductResult[] | null
  error:          string | null
  /** Shallow per-product status map (sku -> status) for quick display. */
  productStatuses: Record<string, 'running' | 'done' | 'error'>
}

export interface AdvanceInflightResult {
  advanced:  number
  submitted: number
  applied:   number
  done:      number
  failed:    number
}

// ─── enqueueBatchJob ──────────────────────────────────────────────────────────

/**
 * Insert a batch_jobs row (status='queued'), mirror a summary to KV for the
 * admin poll surface (24h TTL), and return the jobId. The cron poller does
 * the rest.
 *
 * IMPORTANT: llmClient is stripped from each product's OrchestratorInput
 * before JSONB serialization (spec C0.5 #1). llmClient is a class instance
 * and cannot survive a DB round-trip. The runner always reconstructs with
 * getDefaultClient() (API path), which is intentional -- the batch discount
 * only exists on the API.
 */
export async function enqueueBatchJob(args: EnqueueBatchJobArgs): Promise<{ jobId: string }> {
  const jobId = randomUUID()

  // Strip llmClient before serializing to JSONB.
  const products: BatchJobProduct[] = args.products.map(p => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { llmClient: _omit, ...inputWithoutClient } = p.input
    return {
      productId: p.productId,
      sku:       p.sku,
      input:     inputWithoutClient as Record<string, unknown>,
      via:       'batch' as const,
    }
  })

  const skuList = products.map(p => p.sku)

  await db.insert(batchJobs).values({
    jobId,
    jobType:  args.jobType,
    status:   'queued',
    source:   args.source,
    skuList,
    products,
    turn:     0,
    maxTurns: args.maxTurns ?? 24,
    batchIds:    [],
    runnerState: {},
    appliedSkus: [],
    ...(args.gatesDealId !== undefined ? { gatesDealId: args.gatesDealId } : {}),
  })

  // Best-effort KV mirror for the admin poll surface.
  try {
    const summary: Partial<BatchJobSummary> = {
      jobId,
      jobType: args.jobType,
      status:  'queued',
      source:  args.source,
      skuList,
      turn: 0,
      maxTurns: args.maxTurns ?? 24,
      currentBatchId: null,
      gatesDealId: args.gatesDealId ?? null,
      appliedSkus: [],
      productStatuses: Object.fromEntries(products.map(p => [p.sku, 'running' as const])),
    }
    await kvSet(KV_KEYS.enrichmentJob(jobId), summary, KV_TTL_SECONDS)
  } catch (err) {
    console.warn('[batch-orchestrator] KV mirror failed (non-fatal):', err)
  }

  console.log(`[batch-orchestrator] enqueued job ${jobId} type=${args.jobType} skus=[${skuList.join(',')}]`)
  return { jobId }
}

// ─── advanceInflightJobs (called by the cron poller) ─────────────────────────

/**
 * Select up to maxJobs in-flight batch_jobs and call advanceJob for each.
 * Each advanceJob does ONE retrieve + optionally one submit -- cheap, fits 60s.
 */
export async function advanceInflightJobs(opts: {
  maxJobs?:      number
  perJobBudgetMs?: number
} = {}): Promise<AdvanceInflightResult> {
  const maxJobs = opts.maxJobs ?? 10

  const rows = await db
    .select()
    .from(batchJobs)
    .where(inArray(batchJobs.status, ['queued', 'submitted', 'processing', 'applying']))
    .orderBy(batchJobs.updatedAt)
    .limit(maxJobs)

  const result: AdvanceInflightResult = { advanced: 0, submitted: 0, applied: 0, done: 0, failed: 0 }

  for (const job of rows) {
    try {
      const outcome = await advanceJob(job)
      result.advanced++
      if (outcome.submitted)  result.submitted++
      if (outcome.applied)    result.applied += outcome.applied
      if (outcome.done)       result.done++
      if (outcome.failed)     result.failed++
    } catch (err) {
      console.error(`[batch-orchestrator] advanceJob ${job.jobId} threw:`, err)
      // Mark failed so the poller does not retry forever.
      await db
        .update(batchJobs)
        .set({ status: 'failed', error: String(err), failedAt: new Date(), updatedAt: new Date() })
        .where(eq(batchJobs.jobId, job.jobId))
      result.failed++
    }
  }

  return result
}

// ─── advanceJob (one pass per job per cron tick) ─────────────────────────────

interface AdvanceOutcome {
  submitted?: boolean
  applied?:   number
  done?:      boolean
  failed?:    boolean
}

type BatchJobRow = typeof batchJobs.$inferSelect

async function advanceJob(job: BatchJobRow): Promise<AdvanceOutcome> {
  // field-regen jobs are single-shot (no multi-turn tool loop). Delegate to
  // the dedicated runner which shares the same batchJobs state machine but
  // uses a much simpler one-batch-per-job path.
  if (job.jobType === 'field-regen') {
    const { advanceFieldRegenJob } = await import('~/lib/field-regen-runner.server')
    const r = await advanceFieldRegenJob(job as Parameters<typeof advanceFieldRegenJob>[0])
    // Build the return object only with defined properties (exactOptionalPropertyTypes).
    const out: AdvanceOutcome = {}
    if (r.submitted !== undefined) out.submitted = r.submitted
    if (r.applied   !== undefined) out.applied   = r.applied
    if (r.done      !== undefined) out.done      = r.done
    if (r.failed    !== undefined) out.failed    = r.failed
    return out
  }

  const outcome: AdvanceOutcome = {}

  switch (job.status) {
    case 'queued': {
      // First turn: seed every product's messages[] and submit turn 0.
      const runnerState: Record<string, ProductRunnerState> = {}
      for (const p of job.products) {
        runnerState[p.productId] = freshRunnerState(p, job.jobId)
      }
      // Persist state BEFORE submit so a crash post-submit can re-derive.
      await db
        .update(batchJobs)
        .set({ runnerState, updatedAt: new Date() })
        .where(eq(batchJobs.jobId, job.jobId))

      const updatedJob = { ...job, runnerState } as BatchJobRow
      await submitTurnBatch(updatedJob)
      outcome.submitted = true
      break
    }

    case 'submitted':
    case 'processing': {
      if (!job.currentBatchId) {
        console.error(`[batch-orchestrator] job ${job.jobId} in ${job.status} with no currentBatchId`)
        break
      }

      // ONE retrieve call -- cheap, fits in the 60s budget.
      const client = getClient()
      const batch = await client.messages.batches.retrieve(job.currentBatchId)

      if (batch.processing_status !== 'ended') {
        // Not done yet -- touch updated_at and retry next tick.
        await db
          .update(batchJobs)
          .set({ status: 'processing', updatedAt: new Date() })
          .where(eq(batchJobs.jobId, job.jobId))
        break
      }

      // Batch ended -- stream all results into a map keyed by custom_id.
      const responses = new Map<string, Anthropic.Messages.Batches.MessageBatchIndividualResponse>()
      const stream = await client.messages.batches.results(job.currentBatchId)
      for await (const entry of stream) {
        responses.set(entry.custom_id, entry)
      }

      // Load shared taxonomy once; deep-copy into each product's state (C0.5 #3).
      const [sharedDialRegistry, sharedDialTaxonomy, sharedVocab] = await Promise.all([
        getDialRegistry(),
        getDialTaxonomy(),
        getAskEmmaVocabulary(),
      ])

      // Mutable local copy of runner_state that we update incrementally.
      const runnerState: Record<string, ProductRunnerState> = { ...job.runnerState }

      // Turn-level token aggregation for the single per-turn logApiTokens row.
      let turnInputTokens  = 0
      let turnOutputTokens = 0
      let turnCacheCreation = 0
      let turnCacheRead    = 0
      let turnCount        = 0

      // SEQUENTIAL per-product distribution (C0.5 #2 -- no Promise.all).
      // Two module-level shared hazards make concurrency unsafe:
      //   - drainToolTokens() resets a global accumulator in claude.server.ts
      //   - appendDialLabel mutates dialRegistry and writes to Sanity
      for (const p of job.products) {
        const ps = runnerState[p.productId]
        if (!ps || ps.finished) continue

        // Crash-recovery skip: if this product already processed this batch turn,
        // skip re-execution (per spec C3a -- lastProcessedBatchId guard).
        if (ps.lastProcessedBatchId === job.currentBatchId) continue

        const cid = buildCustomId(job.jobId, p.productId)
        const entry = responses.get(cid)

        if (!entry || entry.result.type !== 'succeeded') {
          // Handle failure modes with mode distinction (spec C4):
          if (entry?.result.type === 'expired') {
            // 24h batch timeout: orphaned tool_use ids possible -> reset to initial seed.
            if (ps.requestRetries < 2) {
              runnerState[p.productId] = {
                ...ps,
                requestRetries: ps.requestRetries + 1,
                messages: [{ role: 'user', content: buildUserPrompt(p.input as OrchestratorInput) }],
                turns: 0,
                lastProcessedBatchId: job.currentBatchId,
              }
            } else {
              runnerState[p.productId] = {
                ...ps,
                status: 'error',
                error: `expired x${ps.requestRetries + 1}`,
                finished: true,
                lastProcessedBatchId: job.currentBatchId,
              }
            }
          } else if (
            (entry?.result.type === 'errored' || entry?.result.type === 'canceled') &&
            ps.requestRetries < 2
          ) {
            // Model never produced an assistant turn -- messages[] unchanged, safe to resubmit.
            runnerState[p.productId] = {
              ...ps,
              requestRetries: ps.requestRetries + 1,
              lastProcessedBatchId: job.currentBatchId,
            }
          } else {
            const errDesc = entry
              ? `batch ${entry.result.type}: ${entry.result.type === 'errored' ? (entry.result as Anthropic.Messages.Batches.MessageBatchErroredResult).error.error.message : entry.result.type}`
              : 'no result for custom_id'
            runnerState[p.productId] = {
              ...ps,
              status: 'error',
              error: errDesc,
              finished: true,
              lastProcessedBatchId: job.currentBatchId,
            }
          }
          // Incremental per-product persist for crash recovery (C3a).
          await db
            .update(batchJobs)
            .set({ runnerState, updatedAt: new Date() })
            .where(eq(batchJobs.jobId, job.jobId))
          continue
        }

        const msg = entry.result.message

        // Accumulate turn-level token usage.
        const u = msg.usage as {
          input_tokens: number; output_tokens: number
          cache_creation_input_tokens?: number; cache_read_input_tokens?: number
        }
        turnInputTokens   += u.input_tokens
        turnOutputTokens  += u.output_tokens
        turnCacheCreation += u.cache_creation_input_tokens ?? 0
        turnCacheRead     += u.cache_read_input_tokens     ?? 0
        turnCount++

        // Append assistant message (mirrors sync loop).
        const updatedMessages = [...ps.messages, { role: 'assistant' as const, content: msg.content }]

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolUses: Array<{ id: string; name: string; input: unknown }> = (msg.content as any[])
          .filter((b: { type: string }) => b.type === 'tool_use')

        // PRIMARY 'model is done' signal: check toolUses FIRST (matches real loop).
        if (toolUses.length === 0) {
          runnerState[p.productId] = {
            ...ps,
            messages: updatedMessages,
            finished: true,
            status: 'done',
            lastProcessedBatchId: job.currentBatchId,
          }
          await db
            .update(batchJobs)
            .set({ runnerState, updatedAt: new Date() })
            .where(eq(batchJobs.jobId, job.jobId))
          continue
        }

        // Reconstruct OrchestratorState with deep-copied shared taxonomy (C0.5 #3).
        const state = stateFor(ps, p, {
          dialRegistry: structuredClone(sharedDialRegistry),
          dialTaxonomy: structuredClone(sharedDialTaxonomy),
          vocab:        structuredClone(sharedVocab),
        })

        // Execute each tool SEQUENTIALLY; try/finally drain ensures global accumulator
        // is always reset even on throw (C0.5 #2 comment).
        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = []
        for (const tu of toolUses) {
          if (ps.calledTools.includes(tu.name)) {
            toolResults.push({
              type:        'tool_result',
              tool_use_id: tu.id,
              content:     JSON.stringify({ ok: false, summary: `${tu.name} already called -- skipping duplicate` }),
            })
            continue
          }
          ps.calledTools.push(tu.name)

          const start = Date.now()
          let ok = false
          let summary = ''
          let errorMsg: string | undefined
          // Drain stale accumulator state before invoking; ensures we only attribute
          // tokens spent inside this specific tool's executeTool call.
          drainToolTokens()
          try {
            const r = await executeTool(tu.name, state)
            ok      = r.ok
            summary = r.summary
          } catch (err) {
            errorMsg = err instanceof Error ? err.message : String(err)
            summary  = `tool error: ${errorMsg}`
          } finally {
            // try/finally guarantees drain even on throw (C0.5 #2).
            const tt = drainToolTokens()
            ps.telemetry = ps.telemetry as unknown as OrchestratorTelemetry
            const tel = ps.telemetry as unknown as OrchestratorTelemetry
            tel.totalInputTokens         = (tel.totalInputTokens  ?? 0) + tt.input
            tel.totalOutputTokens        = (tel.totalOutputTokens ?? 0) + tt.output
            tel.totalCacheCreationTokens = (tel.totalCacheCreationTokens ?? 0) + tt.cacheCreation
            tel.totalCacheReadTokens     = (tel.totalCacheReadTokens     ?? 0) + tt.cacheRead
            const toolCalls = Array.isArray(tel.toolCalls) ? tel.toolCalls : []
            toolCalls.push({
              name:         tu.name,
              durationMs:   Date.now() - start,
              inputTokens:  tt.input,
              outputTokens: tt.output,
              ok,
              ...(errorMsg ? { error: errorMsg } : {}),
            })
            tel.toolCalls = toolCalls
          }

          toolResults.push({
            type:        'tool_result',
            tool_use_id: tu.id,
            content:     JSON.stringify({ ok, summary }),
            ...(errorMsg ? { is_error: true } : {}),
          })

          if (state.finished) ps.finished = true
        }

        // Reconcile any dial proposals from this product's state back into the
        // shared registry so a later product in the same pass sees them (C0.5 #3).
        if (state.dialRegistry) {
          Object.assign(sharedDialRegistry, state.dialRegistry)
        }

        // Carry accumulated writes forward.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ps.writes = state.writes as Record<string, any>

        const finalMessages = [
          ...updatedMessages,
          { role: 'user' as const, content: toolResults },
        ]

        // POST-tool stop_reason check (matches real loop's post-tool `if (stop_reason==='end_turn') break`).
        if (msg.stop_reason === 'end_turn') ps.finished = true
        if (ps.finished) ps.status = 'done'

        runnerState[p.productId] = {
          ...ps,
          messages: finalMessages,
          lastProcessedBatchId: job.currentBatchId,
        }

        // Incremental per-product persist (crash recovery C3a).
        await db
          .update(batchJobs)
          .set({ runnerState, updatedAt: new Date() })
          .where(eq(batchJobs.jobId, job.jobId))
      }

      // Log this batch turn's tokens (best-effort, per-turn aggregate, spec B3.9).
      if (turnCount > 0) {
        void logApiTokens({
          feature:             'enrichment',
          model:               MODEL,
          source:              'batch',
          batchId:             job.currentBatchId,
          requestCount:        turnCount,
          inputTokens:         turnInputTokens,
          outputTokens:        turnOutputTokens,
          cacheCreationTokens: turnCacheCreation,
          cacheReadTokens:     turnCacheRead,
        })
      }

      // Determine next step.
      const nowTurn = job.turn + 1

      // Mark products at the turn cap as finished (no 25th request).
      for (const p of job.products) {
        const ps = runnerState[p.productId]
        if (ps && !ps.finished && ps.status === 'running' && ps.turns >= job.maxTurns) {
          runnerState[p.productId] = { ...ps, finished: true, status: 'done' }
        }
      }

      const stillRunning = job.products.filter(p => {
        const ps = runnerState[p.productId]
        return ps && !ps.finished && ps.status === 'running' && ps.turns < job.maxTurns
      })

      if (stillRunning.length === 0) {
        await db
          .update(batchJobs)
          .set({
            status:          'applying',
            currentBatchId:  null,
            turn:            nowTurn,
            runnerState,
            updatedAt:       new Date(),
          })
          .where(eq(batchJobs.jobId, job.jobId))
      } else {
        const updatedJob: BatchJobRow = {
          ...job,
          turn:           nowTurn,
          runnerState,
          currentBatchId: null,
        }
        await submitTurnBatch(updatedJob)
        outcome.submitted = true
      }

      break
    }

    case 'applying': {
      const runnerState: Record<string, ProductRunnerState> = { ...job.runnerState }
      const appliedSkus: string[] = [...(job.appliedSkus ?? [])]
      const results: BatchJobProductResult[] = [...(job.results ?? [])]
      let appliedThisTick = 0

      for (const p of job.products) {
        const ps = runnerState[p.productId]
        if (!ps || !ps.finished) continue
        if (ps.status === 'error' && !ps.writes) continue  // nothing to apply for runner errors
        if (appliedSkus.includes(p.sku)) continue          // already applied (idempotent on cron retry)

        try {
          const numericId = p.productId.replace('gid://shopify/Product/', '')
          const writes = assembleWrites(
            ps.writes as Partial<ProductWrites>,
            ps.telemetry as OrchestratorTelemetry,
          )
          await applyFullEnrichmentWrites(numericId, writes)
          appliedSkus.push(p.sku)
          appliedThisTick++

          // Update results -- replace any existing entry for this productId.
          const idx = results.findIndex(r => r.productId === p.productId)
          const resultEntry: BatchJobProductResult = { productId: p.productId, sku: p.sku, ok: true, writesApplied: true }
          if (idx >= 0) results[idx] = resultEntry
          else results.push(resultEntry)

          runnerState[p.productId] = { ...ps, applyRetries: 0 }
          await db
            .update(batchJobs)
            .set({ appliedSkus, results, runnerState, updatedAt: new Date() })
            .where(eq(batchJobs.jobId, job.jobId))

        } catch (err) {
          const applyRetries = (ps.applyRetries ?? 0) + 1
          const errMsg = err instanceof Error ? err.message : String(err)

          runnerState[p.productId] = { ...ps, applyRetries }

          const idx = results.findIndex(r => r.productId === p.productId)
          const resultEntry: BatchJobProductResult = {
            productId:   p.productId,
            sku:         p.sku,
            ok:          false,
            applyRetries,
            error:       errMsg,
          }
          if (idx >= 0) results[idx] = resultEntry
          else results.push(resultEntry)

          if (applyRetries >= 3) {
            // Escape hatch: 3 consecutive Shopify-push failures -> permanent fail.
            // Excluded from pending check so the job can still reach terminal state.
            runnerState[p.productId] = {
              ...ps,
              applyRetries,
              status: 'error',
              error:  `apply-permafail: ${errMsg}`,
            }
          }

          await db
            .update(batchJobs)
            .set({ results, runnerState, updatedAt: new Date() })
            .where(eq(batchJobs.jobId, job.jobId))
        }
      }

      outcome.applied = appliedThisTick

      // Pending: products not yet applied AND not permanently failed.
      const pending = job.products.filter(p => {
        const ps = runnerState[p.productId]
        if (!ps) return false
        if (ps.status === 'error') return false  // runner error or apply-permafail
        return !appliedSkus.includes(p.sku)
      })

      if (pending.length === 0) {
        // Gate: activate a gated deal if this job gates one.
        if (job.gatesDealId) {
          await maybeActivateGatedDeal(job.jobId, job.gatesDealId)
        }

        const anyHardError = Object.values(runnerState).some(ps => ps.status === 'error')
        const finalStatus  = anyHardError ? 'failed' : 'done'
        await db
          .update(batchJobs)
          .set({
            status:     finalStatus,
            results,
            runnerState,
            appliedSkus,
            completedAt: new Date(),
            updatedAt:   new Date(),
          })
          .where(eq(batchJobs.jobId, job.jobId))

        if (finalStatus === 'done') outcome.done    = true
        else                        outcome.failed  = true
      }

      break
    }

    case 'done':
    case 'failed':
      // Terminal -- nothing to do.
      break
  }

  // Best-effort KV mirror update.
  try {
    const fresh = await db.select().from(batchJobs).where(eq(batchJobs.jobId, job.jobId)).limit(1)
    const row = fresh[0]
    if (row) {
      const productStatuses: Record<string, 'running' | 'done' | 'error'> = {}
      for (const p of row.products) {
        const ps = row.runnerState[p.productId]
        productStatuses[p.sku] = ps?.status ?? 'running'
      }
      const summary: BatchJobSummary = {
        jobId:           row.jobId,
        jobType:         row.jobType,
        status:          row.status,
        source:          row.source,
        skuList:         row.skuList as string[],
        turn:            row.turn,
        maxTurns:        row.maxTurns,
        currentBatchId:  row.currentBatchId ?? null,
        gatesDealId:     row.gatesDealId ?? null,
        appliedSkus:     (row.appliedSkus as string[]) ?? [],
        createdAt:       row.createdAt,
        updatedAt:       row.updatedAt,
        completedAt:     row.completedAt ?? null,
        failedAt:        row.failedAt ?? null,
        results:         (row.results as BatchJobProductResult[]) ?? null,
        error:           row.error ?? null,
        productStatuses,
      }
      await kvSet(KV_KEYS.enrichmentJob(job.jobId), summary, KV_TTL_SECONDS)
    }
  } catch (err) {
    console.warn('[batch-orchestrator] KV mirror update failed (non-fatal):', err)
  }

  return outcome
}

// ─── submitTurnBatch ──────────────────────────────────────────────────────────

/**
 * Build and submit one Anthropic batch for the current turn, for all products
 * that are still running and under the turn cap. Increments p.turns for each
 * submitted product (pre-increment, mirrors the real loop). Persists runner_state
 * and the job row atomically before returning so the submit + counter bump are
 * visible to crash-recovery on the next tick.
 */
async function submitTurnBatch(job: BatchJobRow): Promise<void> {
  const runnerState: Record<string, ProductRunnerState> = { ...job.runnerState }

  const toSubmit = job.products.filter(p => {
    const ps = runnerState[p.productId]
    return ps && !ps.finished && ps.status === 'running' && ps.turns < job.maxTurns
  })

  if (toSubmit.length === 0) return

  const requests: Array<{
    custom_id: string
    params: Anthropic.Messages.MessageCreateParamsNonStreaming
  }> = []

  for (const p of toSubmit) {
    const ps = runnerState[p.productId]
    if (!ps) continue

    // Pre-increment before submit (mirrors real loop's pre-increment semantics).
    const newTurns = ps.turns + 1
    runnerState[p.productId] = { ...ps, turns: newTurns }

    requests.push({
      custom_id: buildCustomId(job.jobId, p.productId),
      params:    {
        model:      MODEL,
        max_tokens: 4096,
        // Ephemeral cache on tools + system: cache write on first request,
        // reads on subsequent requests within TTL across parallel batch requests.
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools:    TOOLS as any,
        messages: ps.messages,
      },
    })
  }

  if (requests.length === 0) return

  const client = getClient()
  const batch  = await client.messages.batches.create({ requests })

  const isFirstSubmit = !job.submittedAt
  const batchIds: string[] = [...(Array.isArray(job.batchIds) ? job.batchIds as string[] : []), batch.id]

  await db
    .update(batchJobs)
    .set({
      status:          'submitted',
      currentBatchId:  batch.id,
      batchIds,
      runnerState,
      updatedAt:       new Date(),
      ...(isFirstSubmit ? { submittedAt: new Date() } : {}),
    })
    .where(eq(batchJobs.jobId, job.jobId))

  console.log(`[batch-orchestrator] job ${job.jobId} turn ${job.turn + 1}: submitted batch ${batch.id} (${requests.length} requests)`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Custom ID scheme: "${jobId}__${productId}" with double-underscore delimiter.
 * productId is a Shopify GID (gid://shopify/Product/12345) which contains both
 * colons and slashes; a colon delimiter + naive split would corrupt the productId.
 * Double-underscore appears in neither jobId (a UUID) nor a Shopify GID.
 * Demux with lastIndexOf('__'): jobId = cid.slice(0, idx), productId = cid.slice(idx + 2).
 */
function buildCustomId(jobId: string, productId: string): string {
  return `${jobId}__${productId}`
}

function freshRunnerState(p: BatchJobProduct, jobId: string): ProductRunnerState {
  const input = p.input as OrchestratorInput
  return {
    productId:           p.productId,
    sku:                 p.sku,
    messages:            [{ role: 'user', content: buildUserPrompt(input) }],
    calledTools:         [],
    writes:              {},
    telemetry:           {
      totalInputTokens:         0,
      totalOutputTokens:        0,
      totalTokens:              0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens:     0,
      durationMs:               0,
      turns:                    0,
      toolCalls:                [],
    },
    finished:            false,
    turns:               0,
    status:              'running',
    lastBatchCustomId:   buildCustomId(jobId, p.productId),
    requestRetries:      0,
    applyRetries:        0,
  }
}

/**
 * Reconstruct an OrchestratorState from stored ProductRunnerState and a
 * deep-copied shared taxonomy object. Always sets input.llmClient: undefined
 * so generators resolve getDefaultClient() (the API path). The runner never
 * uses the agent-SDK client (spec C0.5 #1).
 */
function stateFor(
  ps: ProductRunnerState,
  p: BatchJobProduct,
  taxonomy: {
    dialRegistry: Awaited<ReturnType<typeof getDialRegistry>>
    dialTaxonomy:  Awaited<ReturnType<typeof getDialTaxonomy>>
    vocab:         Awaited<ReturnType<typeof getAskEmmaVocabulary>>
  },
): OrchestratorState {
  // Strip llmClient so generators resolve getDefaultClient() (API path -- C0.5 #1).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { llmClient: _omit, ...inputWithoutClient } = p.input as OrchestratorInput
  const input: OrchestratorInput = inputWithoutClient
  return {
    input,
    dialRegistry: taxonomy.dialRegistry,
    dialTaxonomy: taxonomy.dialTaxonomy,
    vocab:        taxonomy.vocab,
    writes:       ps.writes as Partial<ProductWrites>,
    telemetry:    ps.telemetry as OrchestratorTelemetry,
    finished:     ps.finished,
  }
}

// ─── Deal-gate helper ─────────────────────────────────────────────────────────

/**
 * Called when a gated job reaches applying->done. Looks up the gated deal and
 * calls activateDeal if it is not already live. Goes through the same
 * activateDeal path so the double-activation guard (deal_status already 'live')
 * covers both the midnight cron and this poller path (spec E1).
 */
async function maybeActivateGatedDeal(jobId: string, gatesDealId: number): Promise<void> {
  try {
    const { dealHistory } = await import('../../db/schema')
    const { eq } = await import('drizzle-orm')
    const rows = await db
      .select()
      .from(dealHistory)
      .where(eq(dealHistory.id, gatesDealId))
      .limit(1)

    const deal = rows[0]
    if (!deal) {
      console.warn(`[batch-orchestrator] maybeActivateGatedDeal: deal ${gatesDealId} not found`)
      return
    }
    if (deal.status === 'live') {
      // Double-activation guard: already live (midnight cron beat us here). No-op.
      return
    }

    const { activateDeal } = await import('~/lib/deal-rotator.server')
    await activateDeal({
      id:               deal.id,
      shopifyProductId: deal.shopifyProductId,
      sku:              deal.sku,
      seoTitle:         deal.seoTitle,
      dealPrice:        deal.dealPrice ?? null,
      msrp:             deal.msrp     ?? null,
      wholesaleCost:    deal.wholesaleCost ?? null,
    })
    console.log(`[batch-orchestrator] job ${jobId} gated deal ${gatesDealId} activated`)
  } catch (err) {
    console.error(`[batch-orchestrator] maybeActivateGatedDeal for job ${jobId} deal ${gatesDealId} failed:`, err)
  }
}

// ─── Public query helpers ─────────────────────────────────────────────────────

export async function getBatchJobById(jobId: string): Promise<BatchJobRow | null> {
  const rows = await db.select().from(batchJobs).where(eq(batchJobs.jobId, jobId)).limit(1)
  return rows[0] ?? null
}

export async function listRecentBatchJobs(limit = 50): Promise<BatchJobRow[]> {
  return db
    .select()
    .from(batchJobs)
    .orderBy(batchJobs.createdAt)
    .limit(limit)
}
