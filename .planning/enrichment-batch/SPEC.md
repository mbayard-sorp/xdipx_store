# Enrichment via Message Batches + Central Token-Spend Logging — Implementation Spec

Status: design, ready to implement. Two coupled changes:

1. **All enrichment runs through the Anthropic Message Batches API** (50% cheaper, async). Every entry point enqueues a `batch_job` and returns a `jobId`; a cron poller advances jobs and applies results. The hard part — the orchestrator's multi-hop tool-use loop — is solved by a **lockstep batched runner** that drives many products' tool-loops together, one Message Batch per turn.
2. **Central token-spend logging** for every Anthropic API-key call, via a wrapper at the llm-client seam, writing per-call rows to `api_token_log` with a daily rollup and an admin usage page.

Hard rules honored: no DB application (write migration files only), no external API calls, `.server.ts` boundary, loader→useLoaderData / action→fetcher, all Shopify in `shopify.server.ts`, Vercel code in `server/`, token logging is best-effort (a logging failure must never throw into a real API call).

Migration numbering: discover the highest existing `NNN` under `db/migrations/` at implementation time and use the next two numbers. At the time of writing the highest was `041_meta_capi_failures.sql`, so this spec refers to the new files as **042** and **043**; if a higher number now exists, shift both accordingly (and keep the two new files consecutive).

---

## Part A — Database

### A1. `db/migrations/042_batch_jobs.sql`

Registry of async enrichment jobs. One row per enqueued enrichment request (single product or bulk).

```sql
-- 042_batch_jobs.sql
-- Registry for asynchronous enrichment jobs driven through the Anthropic
-- Message Batches API. A job owns N products and walks the lockstep batched
-- runner turn-by-turn; one Anthropic batch is submitted per turn. The
-- enrichment-batch-poller cron advances in-flight jobs and applies completed
-- ProductWrites idempotently to Shopify.

CREATE TABLE IF NOT EXISTS batch_jobs (
  id              SERIAL PRIMARY KEY,
  job_id          VARCHAR(64)  NOT NULL,             -- public uuid handed back to callers / KV mirror
  job_type        VARCHAR(32)  NOT NULL,             -- 'full-enrichment' | 'emma-take' | 'emma-hero' | 'regenerate'
  status          VARCHAR(20)  NOT NULL DEFAULT 'queued',
                                                     -- queued | submitted | processing | applying | done | failed
  source          VARCHAR(32)  NOT NULL,             -- entry point: 'bulk-import' | 'import-product' | 'regenerate-keywords' | 'deal-manager' | 'emma-hero' | 'emma-take' | 'backfill'
  -- products in this job (skus + shopify ids + the OrchestratorInput brief)
  sku_list        JSONB        NOT NULL,             -- string[]  (for quick display / dedupe)
  products        JSONB        NOT NULL,             -- Array<{ productId, sku, input: OrchestratorInput }>
  -- lockstep runner progress
  turn            INTEGER      NOT NULL DEFAULT 0,   -- turns completed so far
  max_turns       INTEGER      NOT NULL DEFAULT 24,
  batch_ids       JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- Anthropic batch id per turn, ordered
  current_batch_id VARCHAR(64),                      -- batch awaiting poll (null when none in flight)
  -- per-product runner state (messages[], finished, writes-so-far, telemetry, retries)
  runner_state    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- terminal results
  results         JSONB,                             -- Array<{ productId, sku, ok, writesApplied?, error? }>
  error           TEXT,
  -- gating: deals that must not go live until this job is done
  gates_deal_id   INTEGER,                           -- dealHistory.id this job gates (nullable)
  -- idempotency: products whose ProductWrites have been pushed to Shopify
  applied_skus    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMP    NOT NULL DEFAULT now(),
  submitted_at    TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT now(),
  completed_at    TIMESTAMP,
  failed_at       TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_batch_jobs_job_id ON batch_jobs (job_id);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs (status, created_at);
-- Poller drain: pick up jobs that need advancing.
CREATE INDEX IF NOT EXISTS idx_batch_jobs_inflight ON batch_jobs (updated_at)
  WHERE status IN ('queued','submitted','processing','applying');
CREATE INDEX IF NOT EXISTS idx_batch_jobs_gates_deal ON batch_jobs (gates_deal_id)
  WHERE gates_deal_id IS NOT NULL;

-- Enrichment-cache dead-row hygiene (see Part G). The cache table predates a
-- created_at column; add one (nullable, no backfill) so the post-rollout
-- cleanup `DELETE ... WHERE prompt_version NOT IN (...)` can be time-bounded
-- instead of version-bounded if desired. Safe additive change.
ALTER TABLE product_enrichment_cache ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now();
```

### A2. `db/migrations/043_api_token_log.sql`

Per-call token rows + a daily rollup view.

```sql
-- 043_api_token_log.sql
-- Central per-call token-spend log for EVERY Anthropic API-key call (enrichment,
-- Emma chat, SMS, IVR, copy gen). Written best-effort from logApiTokens() at the
-- llm-client seam; a write failure here must never unwind a real API call.

CREATE TABLE IF NOT EXISTS api_token_log (
  id                    SERIAL PRIMARY KEY,
  ts                    TIMESTAMP    NOT NULL DEFAULT now(),
  feature               VARCHAR(48)  NOT NULL,   -- 'enrichment' | 'emma-chat' | 'sms' | 'ivr' | 'copy-gen' | 'reviews' | 'seo-research' | 'log-monitor' | ...
  model                 VARCHAR(64)  NOT NULL,
  source                VARCHAR(16)  NOT NULL,   -- 'batch' | 'sync' | 'agent-sdk'
  batch_id              VARCHAR(64),             -- Anthropic batch id when source='batch'
  product_id            VARCHAR(64),             -- shopify product id when applicable
  sku                   VARCHAR(32),
  caller                VARCHAR(96),             -- free-form: function / route that originated the call
  input_tokens          INTEGER      NOT NULL DEFAULT 0,
  output_tokens         INTEGER      NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER      NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER      NOT NULL DEFAULT 0,
  request_count         INTEGER      NOT NULL DEFAULT 1,  -- >1 when one row aggregates a batch turn
  est_cost_usd          DECIMAL(10,5) NOT NULL DEFAULT 0,
  request_id            VARCHAR(64)            -- idempotency key for the IVR POST path (B3.8 option B); null otherwise
);

CREATE INDEX IF NOT EXISTS idx_api_token_log_ts ON api_token_log (ts);
-- Idempotency for the optional IVR internal-endpoint path: dedupe on request_id when present.
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_token_log_request_id ON api_token_log (request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_token_log_feature_ts ON api_token_log (feature, ts);
CREATE INDEX IF NOT EXISTS idx_api_token_log_batch ON api_token_log (batch_id)
  WHERE batch_id IS NOT NULL;

-- Daily rollup view — read by /admin/usage.
CREATE OR REPLACE VIEW api_token_daily AS
SELECT
  date_trunc('day', ts)::date          AS day,
  feature,
  model,
  source,
  SUM(request_count)                   AS calls,
  SUM(input_tokens)                    AS input_tokens,
  SUM(output_tokens)                   AS output_tokens,
  SUM(cache_creation_tokens)           AS cache_creation_tokens,
  SUM(cache_read_tokens)               AS cache_read_tokens,
  SUM(est_cost_usd)                    AS est_cost_usd
FROM api_token_log
GROUP BY 1, 2, 3, 4;
```

### A3. `db/schema.ts` additions

Add two `pgTable`s mirroring the migrations (import `jsonb`/`json`, `decimal`, `index`, `uniqueIndex` already present per existing imports). Use `json(...).$type<T>()` for typed payloads.

```ts
export const batchJobs = pgTable('batch_jobs', {
  id: serial('id').primaryKey(),
  jobId: varchar('job_id', { length: 64 }).notNull(),
  jobType: varchar('job_type', { length: 32 }).notNull(),
  status: varchar('status', { length: 20 }).default('queued').notNull(),
  source: varchar('source', { length: 32 }).notNull(),
  skuList: json('sku_list').$type<string[]>().notNull(),
  products: json('products').$type<BatchJobProduct[]>().notNull(),
  turn: integer('turn').default(0).notNull(),
  maxTurns: integer('max_turns').default(24).notNull(),
  batchIds: json('batch_ids').$type<string[]>().default([]).notNull(),
  currentBatchId: varchar('current_batch_id', { length: 64 }),
  runnerState: json('runner_state').$type<Record<string, ProductRunnerState>>().default({}).notNull(),
  results: json('results').$type<BatchJobProductResult[]>(),
  error: text('error'),
  gatesDealId: integer('gates_deal_id'),
  appliedSkus: json('applied_skus').$type<string[]>().default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  submittedAt: timestamp('submitted_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  failedAt: timestamp('failed_at'),
}, t => ({
  jobIdIdx: uniqueIndex('uq_batch_jobs_job_id').on(t.jobId),
  statusIdx: index('idx_batch_jobs_status').on(t.status, t.createdAt),
  gatesDealIdx: index('idx_batch_jobs_gates_deal').on(t.gatesDealId),
}))

export const apiTokenLog = pgTable('api_token_log', {
  id: serial('id').primaryKey(),
  ts: timestamp('ts').defaultNow().notNull(),
  feature: varchar('feature', { length: 48 }).notNull(),
  model: varchar('model', { length: 64 }).notNull(),
  source: varchar('source', { length: 16 }).notNull(),
  batchId: varchar('batch_id', { length: 64 }),
  productId: varchar('product_id', { length: 64 }),
  sku: varchar('sku', { length: 32 }),
  caller: varchar('caller', { length: 96 }),
  inputTokens: integer('input_tokens').default(0).notNull(),
  outputTokens: integer('output_tokens').default(0).notNull(),
  cacheCreationTokens: integer('cache_creation_tokens').default(0).notNull(),
  cacheReadTokens: integer('cache_read_tokens').default(0).notNull(),
  requestCount: integer('request_count').default(1).notNull(),
  estCostUsd: decimal('est_cost_usd', { precision: 10, scale: 5 }).default('0').notNull(),
  requestId: varchar('request_id', { length: 64 }),
}, t => ({
  tsIdx: index('idx_api_token_log_ts').on(t.ts),
  featureTsIdx: index('idx_api_token_log_feature_ts').on(t.feature, t.ts),
}))
```

The view `api_token_daily` is queried with raw SQL via the helper in B2 (Drizzle does not need a view model).

---

## Part B — Central token-spend logging

### B1. `app/lib/model-pricing.server.ts` (NEW)

File name is `app/lib/model-pricing.server.ts` — the `.server.ts` suffix is mandatory. The module contains no Node-only APIs and could in principle run client-side (pure math), but it encodes billing rates that must never ship in the client bundle, so it carries the `.server.ts` suffix. The CLAUDE.md convention is the rule; the "pure math" note is informational only.

Single source of truth for per-MTok rates and cost estimation. No model pricing constants exist anywhere today (only a comment in `emma-budget.server.ts`).

```ts
// Rates are per 1M tokens, in USD, at SYNC (full) price.
// Batch source = 50% of these. Cache write = 1.25× input. Cache read = 0.10× input.
type Rate = { input: number; output: number }
const RATES: Record<string, Rate> = {
  'claude-sonnet-4-20250514':   { input: 3,   output: 15 },
  'claude-sonnet-4-6':          { input: 3,   output: 15 }, // legacy alias used by ai-agent/chat
  'claude-haiku-4-5-20251001':  { input: 1,   output: 5  },
}
const DEFAULT_RATE: Rate = { input: 3, output: 15 } // unknown model → assume Sonnet

export function estimateCostUsd(args: {
  model: string
  source: 'batch' | 'sync' | 'agent-sdk'
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}): number {
  if (args.source === 'agent-sdk') return 0 // billed against Max subscription, not the API key
  const r = RATES[args.model] ?? DEFAULT_RATE
  const mult = args.source === 'batch' ? 0.5 : 1
  const perTok = (rate: number) => (rate * mult) / 1_000_000
  const cost =
    args.inputTokens          * perTok(r.input) +
    args.outputTokens         * perTok(r.output) +
    args.cacheCreationTokens  * perTok(r.input * 1.25) +
    args.cacheReadTokens      * perTok(r.input * 0.10)
  return Math.round(cost * 1e5) / 1e5
}
```

### B2. `app/lib/token-log.server.ts` (NEW)

The single funnel. Every API-key call lands here. **Best-effort: wrap the whole body in try/catch and swallow; never throw.**

```ts
export interface TokenLogEntry {
  feature: string            // 'enrichment' | 'emma-chat' | 'sms' | 'ivr' | 'copy-gen' | ...
  model: string
  source: 'batch' | 'sync' | 'agent-sdk'
  inputTokens: number
  outputTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  requestCount?: number      // default 1; >1 for an aggregated batch turn
  batchId?: string
  productId?: string
  sku?: string
  caller?: string
}

export async function logApiTokens(entry: TokenLogEntry): Promise<void> {
  try {
    const { db } = await import('./db.server')
    const { apiTokenLog } = await import('../../db/schema')
    const { estimateCostUsd } = await import('./model-pricing.server')
    const cacheCreation = entry.cacheCreationTokens ?? 0
    const cacheRead     = entry.cacheReadTokens ?? 0
    const cost = estimateCostUsd({ ...entry, cacheCreationTokens: cacheCreation, cacheReadTokens: cacheRead })
    await db.insert(apiTokenLog).values({
      feature: entry.feature, model: entry.model, source: entry.source,
      batchId: entry.batchId ?? null, productId: entry.productId ?? null, sku: entry.sku ?? null,
      caller: entry.caller ?? null,
      inputTokens: entry.inputTokens, outputTokens: entry.outputTokens,
      cacheCreationTokens: cacheCreation, cacheReadTokens: cacheRead,
      requestCount: entry.requestCount ?? 1, estCostUsd: String(cost),
    })
  } catch (err) {
    console.error('[token-log] best-effort write failed (ignored):', err)
  }
}

// Daily rollup read for /admin/usage. Raw SQL against the view.
export async function getDailyTokenRollup(opts: { days?: number } = {}) {
  const { db } = await import('./db.server')
  const { sql } = await import('drizzle-orm')
  const days = opts.days ?? 30
  // SELECT * FROM api_token_daily WHERE day >= current_date - $days ORDER BY day DESC, est_cost_usd DESC
  return db.execute(sql`SELECT * FROM api_token_daily
    WHERE day >= current_date - ${days}::int
    ORDER BY day DESC, est_cost_usd DESC`)
}
```

### B3. Wiring `logApiTokens()` — covering every api-key call site

The instruction is to centralize logging so ALL api-key calls funnel through `logApiTokens`. There is **no single seam** today: in addition to the two intended seams (`AnthropicSdkClient.create()` for orchestrator turns and `callClaude()` for per-tool generators), there are multiple direct `messages.create` / `messages.stream` call sites that bypass both. This section enumerates **every** call site so none are left as silent bypasses. The reviewer's findings (cache-token loss, bypass call sites, emma-chat/SMS/IVR/reviews/seo/log-monitor) are all addressed concretely below.

#### B3.0. Prerequisite — extend `LLMResponse.usage` with cache fields (code-level, not optional)

`LLMResponse` in `llm-client.server.ts:41-48` exposes only `input_tokens` and `output_tokens`; the mapping at lines 83-87 drops `cache_creation_input_tokens` and `cache_read_input_tokens`. Because the outer orchestrator turns are the dominant enrichment cost, leaving these dropped makes `est_cost_usd` wrong for the dominant path. This fix is a hard prerequisite for accurate logging, not a nice-to-have.

- Extend the `LLMResponse.usage` shape:
  ```ts
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number   // NEW
    cache_read_input_tokens?: number        // NEW
  }
  ```
- In `AnthropicSdkClient.create()`, cast `res.usage` to read the cache fields (the same pattern `callClaude` already uses at `claude.server.ts:85-88`) and populate them via optional chaining. Copy the working extraction pattern from `batch-enrichment.server.ts:447-458` exactly:
  ```ts
  const u = res.usage as { input_tokens: number; output_tokens: number;
    cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
  // ...build LLMResponse.usage from u, including the two cache fields...
  ```

#### B3.1. `AnthropicSdkClient.create()` (`llm-client.server.ts`) — the orchestrator-turn seam

- Extend `LLMRequest` with an optional, non-billing `meta?: { feature: string; source?: 'sync'|'batch'; caller?: string; productId?: string; sku?: string }`.
- At the end of `create()` (after building the extended `usage` from B3.0), fire:
  `void logApiTokens({ feature: req.meta?.feature ?? 'enrichment', model: req.model, source: 'sync', inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheCreationTokens: u.cache_creation_input_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, caller: req.meta?.caller, productId: req.meta?.productId, sku: req.meta?.sku })`. `void` + best-effort = no await unwinding into the API call.
- **`ClaudeAgentSdkClient` path is NOT used by the batch runner** (see C-runner note). For non-runner agent-SDK calls, log with `source: 'agent-sdk'` (cost 0) where the SDK surfaces usage in `runOrchestrationViaSdk` / `runSingleClaudeCallViaSdk`.

#### B3.2. `callClaude()` (`claude.server.ts`) — the per-tool generator seam

`callClaude` already reads cache fields correctly from `msg.usage` (lines 85-97). After the existing accumulator update (~line 98), add:
`void logApiTokens({ feature: opts.feature ?? 'copy-gen', model: opts.model, source: 'sync', inputTokens, outputTokens, cacheCreationTokens: cache_creation, cacheReadTokens: cache_read, caller: opts.caller })`. Add optional `caller?: string` and `feature?: string` to `callClaude` opts so generators can self-label (default feature `'copy-gen'`).

#### B3.3. `claude.server.ts` direct-create bypasses — route or log each (blocker)

`claude.server.ts` has six `client.messages.create()` calls that do NOT go through `callClaude` and would never be logged: `generateWithSystem` (~line 200) and direct calls at ~lines 1597, 1671, 1941, 3374, 3483 (video-prompt generation, rail generation, discovery pick ranker, contextual taglines). For EACH:
- Preferred: route through `callClaude` (same call shape; pass a descriptive `feature`/`caller`). This gets logging + the module accumulator for free.
- If a call cannot be routed (e.g. it needs a response shape `callClaude` does not return), extract `msg.usage` inline (cast for cache fields per B3.0) and add an explicit `void logApiTokens({ feature: <surface>, model, source: 'sync', inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, caller: '<fn name>' })`.
- Line-by-line assignment (rr7-engineer): `generateWithSystem` → `feature:'copy-gen'`; 1597/1671 → `feature:'video-prompt'`; 1941 → `feature:'rail-gen'`; 3374 → `feature:'discovery-rank'`; 3483 → `feature:'contextual-tagline'`. Do not leave any as a silent bypass.

#### B3.4. `emma-chat.server.ts` — streaming hop loop drops cache tokens (blocker)

`emma-chat` uses `getAnthropicClient().messages.stream()` with `cache_control: ephemeral` on the system prompt and accumulates only `totalInputTokens` / `totalOutputTokens` from `finalMessage.usage` (never the cache fields). Emma chat is the highest-frequency cached surface, so dropping cache tokens is a significant misattribution. Fix:
- In the streaming hop loop (~line 287), cast `finalMessage.usage` to include the extended cache fields (same cast pattern as `claude.server.ts:85-88`).
- Accumulate `totalCacheCreationTokens` and `totalCacheReadTokens` across hops alongside the existing totals.
- After the conversation turn completes, fire `void logApiTokens({ feature: 'emma-chat', model, source: 'sync', inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cacheCreationTokens: totalCacheCreationTokens, cacheReadTokens: totalCacheReadTokens, caller: 'emma-chat' })`.

#### B3.5. SMS stages — four files with their own Anthropic clients (major)

`app/lib/sms-v2/stages/objection.server.ts`, `research.server.ts`, `presentation.server.ts`, `post-purchase.server.ts` each instantiate their own client and call `messages.create`/`messages.stream`. None call `logApiTokens`. `objection.server.ts` already extracts cache fields (~lines 229-237); the others do not. For each file, after the usage extraction (add cache-field extraction where missing, cast per B3.0), add:
`void logApiTokens({ feature: 'sms', model, source: 'sync', inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, caller: 'sms/<stage>' })` where `<stage>` is `objection|research|presentation|post-purchase`. Also cover `discovery-welcome` if it makes an api-key call. Purely additive, low-risk.

#### B3.6. reviews-ai / seo-research / log-monitor — total bypasses (major)

`app/lib/reviews-ai.server.ts` (client at line 8, create at ~line 23), `seo-research.server.ts` (creates at ~160/162 and ~295/343), `log-monitor.server.ts` (client at line 14, create at ~line 182) each create their own client and call `messages.create` directly. After each `messages.create`, extract `msg.usage` (cast for cache fields per B3.0) and fire `void logApiTokens({ feature: 'reviews' | 'seo-research' | 'log-monitor', model, source: 'sync', inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, caller: '<fn>' })`. 4–6 lines per call site; self-contained.

#### B3.7. `ai-agent/chat.server.ts` (legacy `claude-sonnet-4-6`)

After its usage extraction, fire `void logApiTokens({ feature: 'emma-chat', model: 'claude-sonnet-4-6', source: 'sync', ... })` (cache fields cast per B3.0).

#### B3.8. `ivr/` package boundary — separate Express server, cannot import `app/` (major)

`ivr/src/claude.ts` (~line 233) cannot import `app/lib`. Two acceptable options; the spec picks **(A)** as default:

- **(A) Direct Neon insert (eliminates the HTTP surface).** `ivr/package.json` already has `@neondatabase/serverless`. Add a tiny `ivr/src/token-log.ts` with a minimal duplicated insert into `api_token_log` (same columns, same best-effort try/catch, computes `est_cost_usd` with a duplicated rate table — IVR uses a fixed model, so the table is one entry). No new network surface, no shared-secret risk.
- **(B) Internal POST endpoint (only if IVR cannot get a Neon connection string).** Add `POST /api/internal/token-log` that calls `logApiTokens`, protected by a **dedicated `IVR_LOG_SECRET`** env var (NOT the shared `CRON_SECRET` — keeps the token-log write vector off the cron secret). The IVR caller generates a `requestId` UUID per call and includes it; the endpoint does `INSERT ... ON CONFLICT (request_id) DO NOTHING` so an IVR retry storm cannot multiply rows. If option (B) is chosen, add a nullable `request_id VARCHAR(64)` column + partial unique index to migration 043.

Either way: `feature: 'ivr'`, `source: 'sync'`, cache fields default 0 if the IVR model is uncached.

#### B3.9. Batch path logging (per-turn aggregate)

The lockstep runner (Part C) reads `MessageBatchIndividualResponse.result.message.usage` per succeeded response. After distributing a turn's results, it fires ONE `logApiTokens({ feature: 'enrichment', model: MODEL, source: 'batch', batchId, requestCount: <#succeeded>, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens })` per turn (summed across that batch's succeeded responses). Per-product attribution stays in `batch_jobs.runner_state`; the token-log row is per-turn-per-batch to keep cardinality sane. **A single enrichment run produces both `source='batch'` rows (outer turns) and `source='sync'` rows (nested per-tool `callClaude`); the admin savings calc in F2 must sum across both sources for the same feature.**

**Reconciliation rule:** PROMPT_VERSION churn (code constant `2026-04-27.d3` vs May rows `2026-05-09.v1`) is documented in Part G; it does not affect token logging (logging keys on feature/model/source, not prompt version) but the runner stamps the **current code `PROMPT_VERSION`** into cache rows so the cache-aware backfill stays valid.

---

## Part C — The lockstep batched runner

New file: `app/lib/batch-orchestrator.server.ts`. Reuses `submitAndPollBatch` from `batch-enrichment.server.ts` but with a **fire-and-poll split** (submit one turn, return; poller retrieves next pass) so it fits Vercel's 60s cron budget.

### C0. Problem restated

`generateProductContent` (emma-orchestrator.server.ts:741-817) is a turn loop: per turn it calls `llm.create({ tools, messages })`, runs the returned tool_use blocks locally via `executeTool(name, state)`, appends `tool_result`s, and repeats until `state.finished` or `stop_reason !== 'tool_use'` (max 24 turns). The Batch API is one-shot per request. So we **externalize the turn loop across many products**: one Anthropic batch == one turn, with one request per still-running product.

The real loop increments `state.telemetry.turns` **before** calling `llm.create` and caps on `turns < MAX_TURNS` — i.e. it fires at most `MAX_TURNS` (24) requests per product. The runner MUST mirror this exactly (see C3 turn-counter semantics) so a product never emits a 25th batch request.

### C0.5. Runner-wide constraints (read before C1–C3)

These are non-negotiable invariants the implementation must hold. Several reviewer blockers/majors collapse into these.

1. **The batch runner always uses the API path (`AnthropicSdkClient`), never `ClaudeAgentSdkClient`.** `OrchestratorInput.llmClient` is a live `LLMClient` class instance with a private SDK client inside it; it is NOT JSON-serializable and cannot survive a round-trip through `batch_jobs.products`/`runner_state` JSONB. Therefore:
   - **Do NOT serialize `llmClient` into `products` JSONB.** Strip it before insert in `enqueueBatchJob`. If the discriminant matters, store only a `via: 'batch'` string (always `'batch'` for runner jobs).
   - `stateFor(p)` reconstructs `OrchestratorState` with `input.llmClient: undefined`, which resolves to `getDefaultClient()` (the API path). Document this so it is not a surprise: a `deal-manager` job enqueued while the app was configured for the agent-SDK still runs through the **API** in the runner (billed to the API key, captured by the batch token log). This is intentional — the batch discount only exists on the API.

2. **The per-product tool-execution loop within `advanceJob` MUST be sequential.** Do NOT `Promise.all` over products. Two shared-mutable hazards force this:
   - `drainToolTokens()` reads/resets a **module-level accumulator** in `claude.server.ts` (`_toolTokenAccumulator`). It is not job- or product-scoped. Concurrent `executeTool` calls would race token accounting. Sequential execution with a `try/finally` drain per tool keeps it correct. Add a code comment in `batch-orchestrator.server.ts` flagging this global-accumulator constraint. (A cleaner long-term refactor — passing a scoped accumulator into `executeTool` — is noted as future work in C4; until then, sequential-only is mandatory and is what makes the current accumulator safe.)
   - `generateSensationDialV2` → `appendDialLabel` mutates `state.dialRegistry` (and writes to Sanity). Two products of the same type proposing dial labels against a **shared** registry object would corrupt both.

3. **Shared taxonomy is loaded once per `advanceJob` call but deep-copied per product.** Load `dialRegistry`/`dialTaxonomy`/`vocab` once at the top of `advanceJob` (one DB/Sanity read), then **deep-copy** them into each product's `stateFor(p)` reconstruction so a mutation in product A's tool run cannot leak into product B. New dial labels proposed during a turn are reconciled back to the shared registry after each product's sequential tool run completes (so a later product in the same pass sees earlier proposals), but each product operates on its own copy during execution.

### C1. Per-product runner state (stored in `batch_jobs.runner_state[productId]`)

```ts
interface ProductRunnerState {
  productId: string
  sku: string
  messages: LLMMessage[]          // the same messages[] the sync loop maintains
  calledTools: string[]           // dedupe set, serialized
  writes: Partial<ProductWrites>  // state.writes accumulated so far
  telemetry: OrchestratorTelemetry
  finished: boolean               // finish tool fired OR model returned no tool_use blocks
  turns: number                   // requests submitted for this product so far (mirrors real loop's pre-increment)
  status: 'running' | 'done' | 'error'   // 'done' set when finished && !error (see C3)
  error?: string
  lastBatchCustomId?: string      // `${jobId}__${productId}` for demux
  requestRetries: number          // per-request batch error retry counter (cap 2)
  applyRetries: number            // Shopify-push failure counter in 'applying' (cap 3 -> permanent fail)
}
```

### C2. Custom ID scheme

`custom_id = "${jobId}__${productId}"` — a **double-underscore** delimiter, NOT a colon. `productId` is a Shopify GID (`gid://shopify/Product/12345`) which contains both `:` and `/`, so a colon delimiter + naive `split(':')` would corrupt the productId (the existing `batch-enrichment.server.ts` avoids this with a `_fullEnrichment` suffix pattern). Double-underscore appears in neither `jobId` (a uuid) nor a Shopify GID. **Demux with `lastIndexOf('__')`**: `jobId = cid.slice(0, idx)`, `productId = cid.slice(idx + 2)`. One in-flight request per product per turn (replaces the legacy `${productId}_tool` single-tool scheme).

### C3. The algorithm (pseudocode)

**Turn-counter semantics (mirror the real loop exactly).** The real orchestrator increments `turns` BEFORE `llm.create` and caps on `turns < MAX_TURNS`, so it fires at most 24 requests. To match: increment `p.turns` at the moment a request is **submitted** for that product (inside `submitTurnBatch`), and gate submission on `p.turns < job.max_turns`. Never increment after tool execution. A product that has already submitted `max_turns` requests is dropped from the next batch and marked finished (its last received result is its final state).

```
advanceJob(job):                                   # called by the cron poller, one pass per invocation
  load job from batch_jobs by job_id
  load + DEEP-COPY-per-product shared dialRegistry/dialTaxonomy/vocab once (see C0.5 #3)
  switch job.status:

    case 'queued':
      # First turn: seed every product's messages[] with the orchestrator user prompt + SYSTEM.
      for p in job.products:
        runner_state[p.id] = freshRunnerState(p)   # messages=[{role:'user', content: buildUserPrompt(p.input)}], turns=0, requestRetries=0, applyRetries=0, status='running'
      persist runner_state                         # persist BEFORE submit so a crash post-submit can re-derive
      submitTurnBatch(job)                          # increments p.turns for each submitted product; status='submitted'
      return

    case 'submitted' | 'processing':
      batch = retrieve(job.current_batch_id)        # ONE retrieve call (cheap, fits 60s)
      if batch.processing_status != 'ended':
        set status='processing'; touch updated_at; return   # try again next cron tick
      results = stream results(job.current_batch_id) keyed by custom_id   # demux via lastIndexOf('__')
      # ---- distribute + run tools locally for each product, SEQUENTIALLY (C0.5 #2) ----
      turnUsage = {in:0,out:0,cc:0,cr:0, count:0}
      for p in inflightProducts(job):                # one product fully before the next; NO Promise.all
        # crash-recovery skip: if this product already advanced for this batch (its messages
        # already carry the assistant turn for this turn index), skip re-execution (C-crash).
        if p.lastProcessedBatchId == job.current_batch_id: continue
        cid = `${job.job_id}__${p.id}`
        r = results[cid]
        if !r or r.result.type != 'succeeded':
          # distinguish failure modes:
          if r.result.type == 'expired':
            # 24h batch timeout. The carried messages[] may now be inconsistent (orphaned
            # tool_use ids with no assistant turn). RESET to the initial seed and retry fresh.
            if p.requestRetries < 2:
              p.requestRetries++; p.messages = [initialSeed(p)]; p.turns = 0
            else: p.status='error'; p.error='expired x'+p.requestRetries; p.finished=true
          elif r.result.type in ('errored','canceled') and p.requestRetries < 2:
            # model never produced an assistant turn; messages[] unchanged -> safe to resubmit as-is.
            p.requestRetries++
          else:
            p.status='error'; p.error=describe(r); p.finished=true
          p.lastProcessedBatchId = job.current_batch_id
          persist runner_state[p.id]                 # single atomic per-product persist (no split)
          continue
        msg = r.result.message
        turnUsage += msg.usage; turnUsage.count++
        # mirror the sync loop body (emma-orchestrator.server.ts:756-816):
        p.messages.push({role:'assistant', content: msg.content})
        toolUses = msg.content.filter(b => b.type=='tool_use')
        # PRIMARY 'model is done' signal — check toolUses FIRST (matches real loop's `if (toolUses.length===0) break`):
        if toolUses.length == 0:
          p.finished = true; p.status='done'
          p.lastProcessedBatchId = job.current_batch_id; persist runner_state[p.id]; continue
        toolResults = []
        st = stateFor(p)                             # deep-copied shared taxonomy; llmClient=undefined (API path)
        for tu in toolUses:
          if p.calledTools includes tu.name: push dup-skip tool_result; continue
          p.calledTools.push(tu.name)
          try {
            drainToolTokens()                        # reset stale
            res = await executeTool(tu.name, st)     # LOCAL, SYNC api calls inside -> logged source:'sync'
          } catch(e){ res = {ok:false, summary:'tool error: '+e} }
          finally { tt = drainToolTokens() }         # try/finally guarantees reset even on throw
          p.telemetry += tt; p.telemetry.toolCalls.push({name, ...tt})
          toolResults.push({type:'tool_result', tool_use_id:tu.id, content: JSON.stringify(res)})
          if st.finished: p.finished = true
        reconcile st.dialRegistry proposals back into shared registry   # C0.5 #3
        p.writes = st.writes                          # carry accumulated writes forward
        p.messages.push({role:'user', content: toolResults})
        # POST-tool stop_reason check (matches real loop's post-tool `if (stop_reason==='end_turn') break`):
        if msg.stop_reason == 'end_turn': p.finished = true
        if p.finished: p.status='done'
        p.lastProcessedBatchId = job.current_batch_id
        persist runner_state[p.id]                    # INCREMENTAL per-product persist (crash recovery, C-crash)
      # ---- log this batch turn's tokens (best-effort, per-turn aggregate) ----
      void logApiTokens({feature:'enrichment', model:MODEL, source:'batch',
        batchId:job.current_batch_id, requestCount:turnUsage.count, ...turnUsage})
      job.turn++ ; persist job
      # ---- decide next step ----
      stillRunning = products where !p.finished and status=='running' and p.turns < job.max_turns
      # any product at the turn cap that is still running is finished now (no 25th request):
      for p in (running products where p.turns >= job.max_turns): p.finished=true; p.status='done'
      if stillRunning is empty:
        set status='applying'; current_batch_id=null; persist; return  # fall through next tick
      else:
        submitTurnBatch(job)   # gates on p.turns < max_turns; increments p.turns per submitted product
        return

    case 'applying':
      # idempotent application of final ProductWrites to Shopify
      for p in job.products where p.finished:          # both 'done' and 'error' are terminal/finished
        if p.status == 'error': continue                # nothing to apply for hard runner errors
        if p.sku in job.applied_skus: continue          # already pushed (idempotent on cron retry)
        try:
          snap = await fetchProductSnapshot(numericIdOf(p.productId))   # handle, vendor, images, editorialTags
          writes = assembleWrites(p.writes, p.telemetry)   # shared coverage gates; throws on 0 tools / empty tagline
          # Reuse the existing applier so Sanity params are assembled correctly (handle, vendor,
          # imageUrl, editorialTags from dealHistory.categories) — do NOT reimplement:
          await applyFullEnrichmentWrites(snap, writes)    # import-enrich.server.ts (Shopify push + Sanity upsert)
          job.applied_skus.push(p.sku)
          record result {productId, sku, ok:true}
        catch(e):
          p.applyRetries = (p.applyRetries ?? 0) + 1
          record result {productId, sku, ok:false, error:e, applyRetries:p.applyRetries}
          if p.applyRetries >= 3: p.status='error'; p.error='apply-permafail: '+e   # escape hatch
          # else: leave out of applied_skus -> retried next tick
        persist runner_state[p.id]
      # blocking check excludes permanently-failed applies so the job can terminate:
      pending = products where p.sku not in applied_skus
                          and not (p.status=='error')               # exclude runner errors + apply-permafail
      if pending is empty:
        if job.gates_deal_id: await maybeActivateGatedDeal(job)     # see Part E (guarded against double-activation)
        set status = (anyHardError(job) ? 'failed' : 'done')        # 'failed' if any p.status=='error'
        set completed_at; persist
      return

    case 'done' | 'failed': return  # terminal
```

Helpers:
- `submitTurnBatch(job)`: select products with `!finished && status=='running' && p.turns < job.max_turns`. For each, **increment `p.turns`** (pre-submit, mirroring the real loop) and build a `BatchRequest`: `params = { model: MODEL, max_tokens: 4096, system: [{type:'text', text: SYSTEM, cache_control:{type:'ephemeral'}}], tools: TOOLS, messages: p.messages }`. Preserves the ephemeral cache directive (cache write on the first request, reads on the rest within TTL across parallel batch requests). Call `client.messages.batches.create({ requests })`, push id to `batch_ids`, set `current_batch_id`, `status='submitted'`, `submitted_at` on first turn. **Persist `runner_state` (with the bumped `turns`) and the job row in one DB update before returning** so the submit + counter bump are atomic.
- `assembleWrites(writes, telemetry)`: lift lines 827-858 of emma-orchestrator into an exported pure function (throws on 0 tool calls / empty tagline) so both the sync path and the runner share the coverage gates.
- `stateFor(p)`: reconstruct an `OrchestratorState` from `runner_state[p.id]` + a **deep copy** of the job's shared `dialRegistry/dialTaxonomy/vocab`. **Always sets `input.llmClient: undefined`** so generators resolve `getDefaultClient()` (the API path) — the runner never uses the agent-SDK client (C0.5 #1). `executeTool` then works unchanged.

### C3a. Crash recovery within a turn (resume point)

The per-product distribution loop persists `runner_state[p.id]` **incrementally after each product** (not once at the end) and stamps `p.lastProcessedBatchId = job.current_batch_id` on each processed product. If the poller crashes mid-loop (OOM, Vercel timeout, kill), the next cron tick re-retrieves the same ended batch (status still `submitted`/`processing`, `current_batch_id` unchanged) and re-enters the loop — but skips any product whose `lastProcessedBatchId` already equals `current_batch_id`. This gives per-product idempotency within a turn and avoids double token spend, duplicate `appendDialLabel` Sanity writes, and duplicate nested generator calls for products that completed before the crash. (Shopify Files image uploads are themselves idempotent, so a residual duplicate there is harmless.)

### C4. Edge cases (all explicitly handled above)

- **Products finishing at different turn counts:** each product flips `finished` independently; only still-running products under the turn cap are in the next `submitTurnBatch`. Partial batches shrink each turn.
- **Per-request batch errors/retries (cap 2), with mode distinction:**
  - `errored` / `canceled`: the model never produced an assistant turn, so `messages[]` is unchanged and safe to resubmit as-is.
  - `expired` (24h batch timeout): the carried conversation may have orphaned tool_use ids with no assistant turn → **reset `messages[]` to the initial seed and `turns=0`** before retrying, rather than carrying a stale/inconsistent context. After cap, marked `error`.
  - The retry-counter increment and the `runner_state` persist happen in a **single per-product DB update** (never split across distribute/submit phases) to avoid a partial-persist race that could over- or under-count retries on a mid-loop crash.
- **Turn cap matches the real loop:** `p.turns` is incremented at submit time and gated on `p.turns < max_turns`, so a product fires at most `max_turns` (24) requests — never a 25th.
- **Partial batches:** a batch with K < N requests is normal (finished/capped products dropped). `request_counts` mismatch is expected.
- **Idempotent ProductWrites application + escape hatch:** `applied_skus` set + per-product try/catch in `applying`. A cron retry re-enters `applying`, skips already-applied SKUs, retries failed ones. After **3** consecutive Shopify-push failures for a product (`applyRetries >= 3`), it is marked `status='error'` (apply-permafail) and **excluded from the blocking `pending` check** so the job can still reach a terminal state instead of looping in `applying` forever (which would block any gated deal).
- **Status is set explicitly:** `p.status='done'` is set the moment `p.finished && !p.error` (no longer left as `'running'`), so the `applying` predicate and the terminal check are unambiguous.
- **Crash recovery within a turn:** see C3a — incremental per-product persist + `lastProcessedBatchId` skip guard.
- **Tool-local API calls stay sync:** `executeTool` may call the API (e.g. `generateMoodImage`, fallback per-field copy). Those remain sync `callClaude`/Imagen calls (logged `source:'sync'`). Only the **outer turn** is batched. This is the correct seam: the 50% batch discount applies to the dominant orchestrator turns; nested generator calls are short and already cache-optimized.

> Trade-off note for reviewers: tool-local generators currently run sync inside `executeTool`. A fully-batched design would also batch those, but that requires a second nested lockstep level and breaks the `executeTool(name,state)→{ok,summary}` contract. Out of scope; documented as a future optimization. The outer turn loop (the multi-hop part) is what the spec batches.
>
> **Future refactor (noted, not in scope):** `drainToolTokens()`/`_toolTokenAccumulator` is a module-level singleton. The clean fix is a scoped accumulator object passed into `executeTool`. Until that lands, the runner's **sequential** per-product loop with `try/finally` drain (C0.5 #2) is what keeps token accounting correct; do not parallelize.

---

## Part D — Cron poller

### D1. `server/cron.ts` — new route

```ts
/**
 * POST /cron/enrichment-batch-poller
 * Schedule: every 2 minutes. Advances every in-flight batch_job by one pass
 * (retrieve current turn's batch; if ended, distribute + run tools + submit
 * next turn or apply). Bounded work per invocation to fit the 60s budget.
 */
router.post('/enrichment-batch-poller', guard, async (_req, res) => {
  try {
    const { advanceInflightJobs } = await import('../app/lib/batch-orchestrator.server.js')
    const result = await advanceInflightJobs({ maxJobs: 10, perJobBudgetMs: 8000 })
    res.json({ ok: true, ...result })  // { advanced, submitted, applied, done, failed }
  } catch (err) {
    console.error('[cron:enrichment-batch-poller]', err)
    res.status(500).json({ error: String(err) })
  }
})
```

`advanceInflightJobs` selects `batch_jobs WHERE status IN ('queued','submitted','processing','applying') ORDER BY updated_at ASC LIMIT maxJobs`, calls `advanceJob` for each (each does ONE retrieve + at most one submit per pass — cheap), and returns counts. Polling cadence is decoupled from Anthropic's batch latency: a job may sit in `submitted`/`processing` across many ticks until its batch `ended`.

### D2. `vercel.json` cron registration

Add `{ "path": "/cron/enrichment-batch-poller", "schedule": "*/2 * * * *" }`. Document in CLAUDE.md Cron Schedule table: `/cron/enrichment-batch-poller | every 2 min | advance + apply in-flight enrichment batch jobs`.

---

## Part E — Entry-point refactors (enqueue + jobId, gate deal activation)

A shared helper `enqueueBatchJob(args): Promise<{ jobId: string }>` in `batch-orchestrator.server.ts`: inserts a `batch_jobs` row (`status='queued'`), mirrors a summary to KV (`KV_KEYS.enrichmentJob(jobId)`, 24h TTL) for the admin poll surface, and returns the `jobId`. It **strips `llmClient` from each product's `OrchestratorInput` before serializing** (C0.5 #1). The cron poller does the rest.

**Scope rule — only the multi-turn orchestrator loop goes async.** The batch API's value is the 50% discount on the dominant multi-hop orchestrator turns (`generateProductContent`). Single-model calls (`generateCopy`, `generateEmmaTake`, `generateEmmaHero`) are one shot — batching them trades a UX regression (admin waits for a poll cycle) for marginal savings. Therefore **only `full-enrichment` jobs (which run the orchestrator) become async**; the single-call admin endpoints stay synchronous. This avoids breaking the existing inline-response UX of the deal-manager.

| Entry point | File | Change |
|---|---|---|
| Bulk import "next" | `app/routes/api.admin.bulk-import.process.tsx` + `bulk-import.server.ts:importProductGroup` | **async.** Split: keep Shopify product **create** (so a product id exists) but replace the inline `generateProductContent`→push with `enqueueBatchJob({ jobType:'full-enrichment', source:'bulk-import', products:[brief] })`. Product lands `queued`/`dealDate 2099-12-31` as today; enrichment applies later via poller. Return `jobId` in the per-group result. The bulk-import admin UI already polls a job surface, so the async transition is natural here. |
| Import product (HTTP, machine-to-machine) | `app/routes/api.import-product.tsx` + `bulk-import.server.ts:importNewProduct` | **async, but contract-preserving for the caller.** Create the Shopify product synchronously (the external product-management agent needs `shopifyProductId`+gid immediately to schedule/approve), then `enqueueBatchJob(...)` for background enrichment. Return `{ shopifyProductId, gid, jobId, status:'enriching' }`. **The agent only needs the id/gid to proceed (enrichment is background); it does NOT block on enriched fields.** Confirm this against the agent's actual workflow before shipping — if the agent does need enriched metafields before its next step, it must poll `GET` the job status via the jobId (document the poll endpoint + response shape from F1). Do not change the synchronous `{ shopifyProductId, gid }` portion of the contract. |
| Regenerate with keywords | `app/routes/api.regenerate-with-keywords.tsx` | **KEEP SYNCHRONOUS.** This route uses `generateCopy` (parallel single-model Anthropic calls), not the orchestrator tool-loop — there is no multi-turn cost to justify async, and the admin UI reads the returned `{ ok, handle, types: { [type]: { ok, content } } }` map inline for human review before saving. Converting it to a jobId would break that UX and force a mapping from `ProductWrites` back to the per-type shape that does not exist. No change beyond the B3.2 token logging that `callClaude`/`generateCopy` already inherit. |
| Deal-manager generate-all | `app/routes/admin.deal-manager.tsx` (intent `generate-all`) | **KEEP SYNCHRONOUS by default.** This intent calls the legacy `generateCopy` set (tagline, full_story, both_ways, seo_meta, box_contents, specifications) + `pushProductToShopify`, NOT `generateProductContent`. The runner is built around the orchestrator tool-loop and has no job type for the legacy copy set; routing this through the runner would require a parallel job type that replicates legacy copy. Keep it sync. **If/when the team wants this deal to also be gated, it should be enrolled via the approval-time enrollment in E1 (which enqueues a `full-enrichment` job), not by converting `generate-all` to async.** |
| Emma hero regenerate | `app/routes/api.admin.emma-hero.regenerate.tsx` | **KEEP SYNCHRONOUS.** Single-model call; the deal-manager UI consumes `{ ok: true, copy }` inline. Async would regress the admin UX for marginal savings. No change beyond inherited token logging. (If a future bulk hero-refresh is wanted, add it behind a separate `?async=1` path; do not change the default.) |
| Emma take regenerate | `app/routes/api.admin.emma-take.regenerate.tsx` | **KEEP SYNCHRONOUS.** Single-model call; UI consumes `{ ok: true, html, written }` inline. Same reasoning as emma-hero. No change beyond inherited token logging. |
| Backfill script | `scripts/backfill-product-enrichment.ts` | **async (full-enrichment).** Default `--via=batch` enqueues jobs and polls the registry to completion (CLI can loop `advanceJob` directly without the cron). Keep `--via=claude-code` (Max) and the cache-aware fill-gaps path working — see Part G. |

Consequently `batch_jobs.job_type` is effectively `'full-enrichment'` for all real jobs in this rollout; the `'emma-take' | 'emma-hero' | 'regenerate'` enum values are retained in the schema for forward-compat but are NOT wired to any async entry point in this spec.

### E1. Deal-activation gating (the dependency)

`activateDeal` (deal-rotator.server.ts:142) must NOT publish / fire Klaviyo until the deal's enrichment job has finished, but must NOT deadlock if enrichment fails, and must NOT double-fire if both the cron and the poller race to activate.

**Gate query — distinguish "still running" from "failed" (no permanent deadlock).** A `failed` job must NOT block activation forever; a stuck `failed` row would otherwise leave the deal permanently ungated and the midnight cron returning early on every run. Query only the genuinely-in-flight statuses:

```ts
const blocking = await db.select({ id: batchJobs.id }).from(batchJobs).where(and(
  eq(batchJobs.gatesDealId, deal.id),
  inArray(batchJobs.status, ['queued','submitted','processing','applying']),
))
if (blocking.length > 0) {
  log('[deal-rotator] enrichment in flight, deferring activation'); return  // cron / poller retries
}
// A 'failed' gating job does NOT block: log a warning and proceed (degraded-enrichment path).
const failed = await db.select({ id: batchJobs.id }).from(batchJobs).where(and(
  eq(batchJobs.gatesDealId, deal.id), eq(batchJobs.status, 'failed')))
if (failed.length > 0) log('[deal-rotator] WARN gated enrichment failed; activating with stale/partial copy')
```

The product exists in Shopify regardless; going live with partial copy beats blocking the storefront forever. Document this as the **degraded-enrichment path**.

**Double-activation guard (race between midnight cron and poller).** Two paths can call `activateDeal`: (1) the midnight `deal-activator` cron, (2) `maybeActivateGatedDeal` from the poller's `applying→done` transition. Without a guard, both can fire near 11:59 PM → Klaviyo emails twice (Shopify `setDealStatus` is idempotent, the email is not). Add a test-and-set:

- **Guard at the top of `activateDeal`:** if the deal's `deal_status` is already `'live'`, return early (no-op). The existing `setDealStatus` call in `deal-rotator.server.ts:176` is the natural place to read/flip status.
- Prefer a DB-level atomic claim before sending the email: `UPDATE deal_history SET deal_status='live' WHERE id = $id AND deal_status <> 'live' RETURNING id`. If it returns no row, another path already activated → return without firing Klaviyo. (Or wrap the activation in a Postgres advisory lock keyed on `deal.id`.) `maybeActivateGatedDeal` goes through the same `activateDeal`, so the guard covers both callers.

**`maybeActivateGatedDeal(job)`:** when a gated job reaches `done`, look up `gates_deal_id`'s deal row and, if it is the staged/next deal whose `deal_date` is today and `deal_status` is not already `'live'`, call `activateDeal(...)` (which now passes the gate and the double-activation guard). Klaviyo fires only after enrichment metafields are written (the existing line 274 `triggerDailyDealEmail` stays downstream of the gate).

**Remove the competing inline copy generation.** `activateDeal` currently generates Emma hero copy inline and synchronously (deal-rotator.server.ts:191-254). When the deal has a gated `full-enrichment` job, that inline generation is a **second writer** that would overwrite the freshly-applied orchestrator writes (or race them on retry ticks). **Guard it:** skip the inline hero generation when a `gates_deal_id` job exists for this deal (the orchestrator already wrote `tagline`/`emmaHero`/etc. during `applying`). Only fall back to inline generation for legacy/ungated deals that have no batch job.

**Enrollment trigger — Option A (approval-time), chosen.** The reviewer correctly notes the 11:45pm `daily-feed-processor` cron has no way to know which `dealHistory` row is "tomorrow's deal" (that row is created upstream by approval/import, not by the scorer). Picking the deal-to-enrich mapping at the only moment it is known with certainty:

- **At admin approval** (`admin.today.tsx` and/or `admin.deal-manager.tsx`, intent `approve`/`schedule`), immediately `enqueueBatchJob({ jobType:'full-enrichment', source:'deal-manager', products:[brief], gatesDealId: dealHistory.id })`. This is the moment the deal row exists and is bound to a date, so `gatesDealId` is set with zero timing dependency on the crons.
- The poller then runs the job over the intervening hours; by the time `deal-activator` (11:59pm) fires, the job is normally `done` and `maybeActivateGatedDeal` (or the cron's own gate check) lets activation proceed. If still in flight, activation defers cleanly; if `failed`, activation proceeds degraded (above).
- The 11:45pm `daily-feed-processor` is **not** used as the enrollment trigger (it cannot identify the row). Do not wire `gatesDealId` there. This makes the gate live in real production (Option A) rather than dead code (which it would be if `gatesDealId` were only set by a cron that lacks the mapping).

---

## Part F — Admin UI

### F1. Job-status surface — `app/routes/admin.async-jobs.tsx` (+ `app/routes/api.admin.async-jobs.poll.tsx`)

- **Loader:** `requireAdmin`, list recent `batch_jobs` (DB) + KV summaries; return client-safe summaries (omit `products`/`runner_state` blobs — analogous to `toSummary()`). All job state flows through the loader (data-flow rule honored).
- **Polling without `useEffect`-for-fetching (CLAUDE.md rule).** Do NOT copy the bulk-import `useFetcher`+`useEffect` fetch pattern (that page is a pre-existing violation; do not propagate it). Instead drive re-loads through the loader via **`useRevalidator`**: a `setTimeout`/`setInterval` calls `revalidator.revalidate()` on a ~3s cadence (batch latency is minutes, not ms), re-running the loader so all data still comes from the loader. The interval is a UI timer, not a data fetch — it triggers loader revalidation rather than calling `fetch`. Clear the timer once every visible job is terminal (`done`/`failed`). This keeps primary data flowing through `loader → useLoaderData`.
  - Acceptable alternative: a `<meta http-equiv="refresh" content="3">` on the route while any job is non-terminal (pure loader re-run, zero JS), dropped once all terminal.
  - The separate `api.admin.async-jobs.poll.tsx` action is only needed if a single-job detail fetch is wanted; the list view should rely on loader revalidation, not a fetcher. If kept, it must be a thin loader-equivalent, not a `useEffect` fetch.
- **UI (mobile-first, 375px):** progress = `(turn / max_turns)` or `(applied / total)`; status badge `queued|submitted|processing|applying|done|failed`; per-product mini-grid (sku, finished?, error?, applyRetries); expandable error log. Reuse `StatCard` from bulk-import.

### F2. Usage page — `app/routes/admin.usage.tsx`

- **Loader:** `requireAdmin`; call `getDailyTokenRollup({ days: 30 })`; also a month-to-date total (`SUM(est_cost_usd)`), and a breakdown by `feature` and by `source` (batch vs sync vs agent-sdk).
- **UI (mobile-first):**
  - Top KPI row (`StatCard`): MTD spend $, total calls, total tokens, batch-vs-sync split %.
  - Table/cards by day: day, feature, model, source, calls, in/out/cache tokens, est $.
  - Section "Savings": **must aggregate across BOTH `source` values for the same feature.** One enrichment run produces `source='batch'` rows (outer turns) AND `source='sync'` rows (nested per-tool `callClaude`); querying only `source='batch'` would understate actual cost and overstate the discount. Compute:
    - `sync_equivalent = SUM(input_tokens + cache_creation_tokens*1.25 + cache_read_tokens*0.10 + output_tokens) * sync_rate` (what it would have cost at full sync price), compared against `SUM(est_cost_usd)` (actual).
    - Group by `feature` **without `source`** for the headline savings row; break out by `source` only in the detail table below. Document this in the loader comment so a future edit does not re-introduce the source filter.
  - Optional `intent=export-csv` action.
- Add nav links for `/admin/async-jobs` and `/admin/usage` in `app/components/admin/AdminNav.tsx`.

---

## Part G — Back-compat & versioning notes

- **Cache-aware backfill still works:** the enrichment cache (`productEnrichmentCache`, keyed by `productId, fieldName, voiceHash, promptVersion`) is read in the sync fill-gaps path and is untouched. Batch jobs that complete should still write cache rows (best-effort) stamped with the **current code `PROMPT_VERSION`** so subsequent fill-gaps runs hit cache.
- **PROMPT_VERSION reconciliation:** code constant is `2026-04-27.d3` but May cache rows carry `2026-05-09.v1` — they diverged because a manual May run hard-coded a version string. **Action:** bump the code `PROMPT_VERSION` constant to a single current value (e.g. `2026-06-06.v1`) and document that older rows (`.d3`, `.v1`) are treated as cache-miss (regenerated on next touch).
  - **Operator cost note (put in the backfill script header).** The first batch run after the bump is a full cache-miss for every product: at ~3K input tokens/product, Sonnet pricing, 50% batch discount, a 17K-SKU full-feed pass costs roughly **$75–100 extra** that one run. This is an explicit operator decision, not a silent side-effect of a constant rename — surface it before the flag merges.
  - **Optional `--allow-cross-version-cache` flag** on the backfill: reads old-version rows anyway (accepting slight prompt drift) for a cheap re-run, and only bumps the stored version if the new output actually differs. Use when the prompt change is cosmetic and a $75–100 re-spend is not justified.
- **Dead-row hygiene for `product_enrichment_cache`:** old-version rows are never hit by the new code but never deleted either, so they accumulate unbounded on a large catalog. Migration 042 adds a nullable `created_at` column (above). Choose one cleanup path and record it: (A) a periodic job / one-off `DELETE FROM product_enrichment_cache WHERE prompt_version NOT IN ('2026-06-06.v1')` run after the rollout stabilizes, or (B) time-bounded `DELETE ... WHERE created_at < now() - interval 'N days'`. Rows are small, so this is minor — but the choice must be acknowledged, not left implicit.
- **`ivr/` package boundary:** default to a **direct Neon insert** from `ivr/src/token-log.ts` (IVR already depends on `@neondatabase/serverless`), eliminating any HTTP write surface (see B3.8 option A). If a direct DB connection is not available, fall back to `POST /api/internal/token-log` protected by a **dedicated `IVR_LOG_SECRET`** (NOT the shared `CRON_SECRET`) with a `requestId` UUID + `INSERT ... ON CONFLICT (request_id) DO NOTHING` for idempotency under retry storms (B3.8 option B; requires the `request_id` column in migration 043).
- **Agent-SDK calls cost $0** in the log (Max subscription), but are still recorded with `source='agent-sdk'` for volume visibility.

---

## Implementation order (independent-ish chunks)

1. Migrations 042/043 + schema + `model-pricing.server.ts` + `token-log.server.ts`.
2. **First** extend `LLMResponse.usage` with cache fields (B3.0) — prerequisite for accurate cost. **Then** wire `logApiTokens` into `llm-client` (B3.1), `callClaude` (B3.2), the six `claude.server.ts` direct bypasses (B3.3), `emma-chat` cache accumulation (B3.4), the four SMS stages (B3.5), reviews/seo/log-monitor (B3.6), ai-agent (B3.7), and IVR (B3.8). (Shippable alone — pure observability. No call site left as a silent bypass.)
3. `assembleWrites` extraction from emma-orchestrator + `batch-orchestrator.server.ts` runner.
4. Cron route + `vercel.json` + CLAUDE.md doc.
5. Entry-point refactors + deal-activation gate.
6. Admin `async-jobs` + `usage` pages + nav.

Verify each chunk with `npm run typecheck` and `npm run build` (no external calls, no migration application).
