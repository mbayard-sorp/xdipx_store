# Plan — `/admin/emma-chat` (Internal Emma Product-SME Chat)

> Status: Drafted 2026-05-07. Ready for execution. Each phase is self-contained
> and can be picked up by a fresh agent in a new chat context.

## Goal

Internal-only admin tool for drafting Reddit replies (initially r/sextoys) with
Emma as a frank product SME. Multi-thread (one per Reddit post), persisted in
Neon. Powered by Claude Sonnet via Anthropic SDK with **tool-use** so the model
can search and inspect the live Shopify catalog (~1K+ SKUs). Reddit-flavored
markdown output: any product mention emits `[Title](https://xdipx.com/products/{slug})`
which is exactly Reddit's link format. Streaming responses via manual SSE
(no Vercel AI SDK in this codebase).

## Non-Goals (out of scope for v1)

- Public-facing chat UI (this is admin-only).
- Reddit posting via API. Output is copy-paste only.
- Cross-thread memory / RAG. Each thread is its own context window.
- Image generation. Text only.
- Editing/deleting messages mid-thread (append-only log for v1).

## Architectural Decisions (made by orchestrator from Phase 0 discovery)

| Decision | Choice | Rationale |
|---|---|---|
| LLM client | `@anthropic-ai/sdk` v0.39.0, `client.messages.create` (streaming) | Matches every other Claude call site in repo; no AI SDK installed |
| Model | `claude-sonnet-4-20250514` | Canonical model; 1M context handles long Reddit threads + tool-use loops |
| Tool-use loop | Mirror `app/lib/emma-orchestrator.server.ts:745-817` | Battle-tested pattern in this codebase |
| Streaming | Manual SSE via `ReadableStream` from a route action | No precedent in repo; simplest option, no new deps |
| DB primary keys | `SERIAL` (not UUID) | Matches existing `emma_chat_sessions`/`emma_chat_turns` convention |
| Persistence | Drizzle on Neon, append-only message log | Matches existing chat tables |
| Auth | `requireAdmin(request)` from `app/lib/session.server.ts` | Standard admin guard |
| UI pattern | `useFetcher` + `fetcher.Form`, no full reloads | Dominant admin pattern (zero raw `<Form>` in admin routes) |
| Catalog access | Tool-use, not stuffed-in-prompt | 1K+ SKUs; many in draft going live today |
| Brand color in chat | Coral CTAs, cream surfaces, ink text | App.css `@theme` tokens |

## File Inventory

### New files
- `db/migrations/032_emma_chat_threads_messages.sql`
- `app/lib/emma-chat.server.ts` — system prompt, tool defs, streaming loop, persistence
- `app/lib/emma-chat-tools.server.ts` — Anthropic tool schemas + tool executors
- `app/routes/admin.emma-chat.tsx` — thread list (loader + action: new thread)
- `app/routes/admin.emma-chat.$threadId.tsx` — chat UI (loader: messages; action: post user message)
- `app/routes/api.admin.emma-chat.stream.$threadId.tsx` — SSE streaming endpoint
- `app/components/admin/EmmaChat/ChatMessage.tsx` — single message bubble + markdown render
- `app/components/admin/EmmaChat/ChatComposer.tsx` — input box + submit
- `app/components/admin/EmmaChat/QuickActions.tsx` — "More direct", "Shorter", etc.
- `app/components/admin/EmmaChat/CopyButton.tsx` — copy-reply-to-clipboard
- `app/components/admin/EmmaChat/NewThreadForm.tsx` — Reddit URL + post excerpt + first question

### Files extended
- `db/schema.ts` — add `emmaChatThreads` and `emmaChatMessages`
- `app/lib/shopify.server.ts` — add `buildShopifyQuery()` helper + export `parseMetafield` / `parseMetafieldJSON`
- `app/components/admin/AdminNav.tsx` — add `/admin/emma-chat` to `NAV_ITEMS`

### Files referenced (do not modify)
- `app/lib/claude.server.ts` — read-only reference for client init pattern
- `app/lib/emma-orchestrator.server.ts` — copy tool-use loop from lines 745–817
- `app/lib/ai-agent/chat.server.ts` — copy chat-loop variant from lines 425–463
- `app/lib/session.server.ts` — `requireAdmin()`
- `app/lib/db.server.ts` — `db` export
- `app/lib/kv.server.ts` — `cached()` wrapper for catalog reads
- `scripts/apply-migrations.ts` — `--from 032`

---

## Phase 0 — Documentation Discovery (DONE)

Output captured in this PLAN's "Architectural Decisions" + "File Inventory"
sections. Key findings:

1. **Anthropic SDK v0.39.0** is the only LLM client. No Vercel AI SDK in repo.
2. **Tool-use precedent exists** in two places — copy from `emma-orchestrator.server.ts`.
3. **No streaming-to-browser pattern exists yet** — this feature establishes it.
4. **Schema convention is `SERIAL` integers**, `TIMESTAMP` (not `TIMESTAMPTZ`),
   `VARCHAR(10)` for role, `JSONB` for structured data, `REFERENCES … ON DELETE CASCADE`,
   no transaction wrappers in migration files (the apply script splits on `;\n`).
5. **Next migration number = 032** (031 is the highest existing).
6. **`requireAdmin(request)` throws redirect** to `/admin/login` if no session.
7. **Brand tokens** all live in `app/app.css` under `@theme`: `bg-cream`, `bg-cream-2`,
   `bg-paper`, `text-ink`, `text-muted`, `border-line`, `bg-coral`, `bg-sage`.

Anti-patterns to guard against in later phases:
- Do **not** use UUID PKs (despite original spec) — match `emma_chat_sessions` precedent.
- Do **not** install Vercel AI SDK / `ai` package — codebase deliberately stays on raw SDK.
- Do **not** use `useEffect` for streaming — wire the SSE consumer through
  `useFetcher`-friendly route boundaries instead.
- Do **not** stuff the catalog into the system prompt — use tool-use exclusively.
- Do **not** call any `.server.ts` file from a client component.

---

## Phase 1 — Database Schema

**Owner:** primary agent (no subagent needed — small, deterministic).

### What to implement

1. Create `db/migrations/032_emma_chat_threads_messages.sql` with these two tables:

```sql
-- 032_emma_chat_threads_messages.sql
--
-- Internal Emma chat: one thread per Reddit post being responded to,
-- one row per message (user / assistant / tool). Append-only.

CREATE TABLE IF NOT EXISTS emma_chat_threads (
  id                    SERIAL PRIMARY KEY,
  title                 VARCHAR(200) NOT NULL DEFAULT 'New thread',
  reddit_post_url       TEXT,
  reddit_post_excerpt   TEXT,
  archived              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS emma_chat_threads_updated_idx
  ON emma_chat_threads (updated_at DESC);

CREATE INDEX IF NOT EXISTS emma_chat_threads_archived_idx
  ON emma_chat_threads (archived, updated_at DESC);

CREATE TABLE IF NOT EXISTS emma_chat_messages (
  id              SERIAL PRIMARY KEY,
  thread_id       INTEGER NOT NULL REFERENCES emma_chat_threads(id) ON DELETE CASCADE,
  role            VARCHAR(10) NOT NULL,   -- 'user' | 'assistant' | 'tool'
  content         TEXT NOT NULL DEFAULT '',
  tool_calls      JSONB,                  -- assistant rows: array of {id,name,input}
  tool_results    JSONB,                  -- tool rows: array of {tool_use_id,content,is_error}
  stop_reason     VARCHAR(20),            -- assistant rows: end_turn | tool_use | max_tokens
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  latency_ms      INTEGER,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS emma_chat_messages_thread_idx
  ON emma_chat_messages (thread_id, created_at);
```

2. Update `db/schema.ts` — append two new tables matching the SQL exactly:

```ts
export const emmaChatThreads = pgTable('emma_chat_threads', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 200 }).notNull().default('New thread'),
  redditPostUrl: text('reddit_post_url'),
  redditPostExcerpt: text('reddit_post_excerpt'),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const emmaChatMessages = pgTable('emma_chat_messages', {
  id: serial('id').primaryKey(),
  threadId: integer('thread_id').notNull()
    .references(() => emmaChatThreads.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 10 }).notNull(),
  content: text('content').notNull().default(''),
  toolCalls: jsonb('tool_calls').$type<Array<{ id: string; name: string; input: Record<string, unknown> }>>(),
  toolResults: jsonb('tool_results').$type<Array<{ tool_use_id: string; content: string; is_error?: boolean }>>(),
  stopReason: varchar('stop_reason', { length: 20 }),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
```

3. Apply the migration locally:
```bash
tsx scripts/apply-migrations.ts --from 032
```

### Verification

- [ ] `psql $DATABASE_URL -c '\d emma_chat_threads'` shows the columns above.
- [ ] `psql $DATABASE_URL -c '\d emma_chat_messages'` shows the columns above + the FK.
- [ ] `tsc --noEmit` passes after `db/schema.ts` edit.
- [ ] No drizzle-kit drift warnings (we are NOT generating drizzle migrations — hand-written only per CLAUDE.md memory).

### Anti-pattern guards

- Do **not** use UUID PKs.
- Do **not** wrap migration in `BEGIN; … COMMIT;` — apply script splits on `;\n`.
- Do **not** use `TIMESTAMPTZ` — use bare `TIMESTAMP` to match repo convention.
- Do **not** define a Postgres ENUM for role — use `VARCHAR(10)` per `emma_chat_turns` precedent.

---

## Phase 2 — Shopify Search Helpers

**Owner:** delegate to `shopify-ops` agent.

### What to implement

The catalog already has `searchAdminProducts(query, limit)` and Storefront
`searchProducts({ query, productFilters, … })`. We just need a query-string
builder so the Claude tool can compose tag/category/price filters cleanly,
and we need to expose two parse helpers that are currently internal.

In `app/lib/shopify.server.ts`:

1. **Export the two existing internal helpers** (currently file-private at lines 278–286):
```ts
export function parseMetafield(metafields: MetafieldEdge[], key: string): string | null
export function parseMetafieldJSON<T>(metafields: MetafieldEdge[], key: string, fallback: T): T
```

2. **Add `buildShopifyQuery()` helper** (string-builder for Storefront `products(query: …)`):
```ts
/**
 * Build a Shopify Storefront `products(query: …)` search string from structured filters.
 * Returns a string like: `title:*wireless* AND tag:for-him AND tag:couples AND variants.price:>=20 AND variants.price:<=100`
 *
 * Used by the Emma chat `search_products` tool.
 */
export function buildShopifyQuery(input: {
  keyword?: string
  tags?: string[]
  productType?: string
  priceMin?: number
  priceMax?: number
  excludeArchivedDeals?: boolean
}): string
```

Tag combinators are all `AND`. If `excludeArchivedDeals` is true, append
`AND -tag:deal-status-archived`. If `keyword` is present, wrap as
`title:*${keyword}*`. Strip Shopify-special chars (`:`, `(`, `)`, `*`)
from user-supplied input before quoting.

3. **Add `searchCatalogForEmma()`** — thin wrapper that calls the existing
`searchProducts()` Storefront helper, picks the first 20 results, normalizes
each into a compact "card" shape the Claude tool can consume:

```ts
export interface EmmaProductCard {
  handle: string                  // canonical slug
  url: string                     // full https://xdipx.com/products/{handle}
  title: string
  productType: string | null
  priceUsd: number
  compareAtUsd: number | null
  available: boolean
  mapRestricted: boolean
  tagline: string | null
  productTypeDial: string | null  // 'air-pulsation' | 'vibrator' | …
  audienceTags: string[]
  moodTags: string[]
  mattersTags: string[]
}

export async function searchCatalogForEmma(input: {
  keyword?: string
  tags?: string[]
  productType?: string
  priceMin?: number
  priceMax?: number
  limit?: number              // default 20, max 30
}): Promise<EmmaProductCard[]>
```

Wrap the call in `cached(key, READ_TTL, fn)` where the key is a hash of the
input — repeated tool calls during one chat session hit the L1 cache.

4. **Add `getProductDetailForEmma()`** — wrapper around the existing
`getProductByHandle(handle)` that returns the full enrichment payload Claude
might want when drilling into a single product:

```ts
export interface EmmaProductDetail extends EmmaProductCard {
  fullStory: string | null
  featureBullets: string[] | null
  sensationDial: Record<string, number> | null
  pairingWhy: Record<string, string> | null
  accessoryHandles: string[]              // resolved from accessory_product_ids
  imageUrl: string | null
  variants: Array<{ id: string; title: string; priceUsd: number; available: boolean }>
}

export async function getProductDetailForEmma(handle: string): Promise<EmmaProductDetail | null>
```

`accessory_product_ids` stores Shopify GIDs; resolve to handles via the
existing `getProductsByIds()` helper.

### Verification

- [ ] `tsc --noEmit` passes.
- [ ] In a quick repl/script: `searchCatalogForEmma({ keyword: 'wand' })` returns
  ≥1 card with non-null `handle`, `priceUsd`, `url` ending in `/products/{handle}`.
- [ ] `getProductDetailForEmma('<handle>')` for a known live product returns
  populated `productTypeDial` and `sensationDial` (or `null` for unenriched ones).
- [ ] `parseMetafield` and `parseMetafieldJSON` are now exported — check with
  `grep -n 'export function parseMetafield' app/lib/shopify.server.ts`.

### Anti-pattern guards

- Do **not** add a parallel REST search path. Reuse the existing GraphQL helpers.
- Do **not** invent metafield keys — every key referenced must exist in
  `METAFIELDS_FRAGMENT` at `app/lib/shopify.server.ts:81`. If a key is missing
  there, add it to the fragment in this same phase.
- Do **not** drop `cached()` from list calls — repeated identical tool calls in
  a chat session must be O(1) on the second hit.
- Do **not** write to Shopify from any of these helpers — read-only.

---

## Phase 3 — Emma-SME Server Lib (`emma-chat.server.ts` + tools)

**Owner:** primary agent.

### What to implement

#### 3a. `app/lib/emma-chat-tools.server.ts`

Anthropic tool schemas + executor functions.

```ts
import type Anthropic from '@anthropic-ai/sdk'
import { searchCatalogForEmma, getProductDetailForEmma } from './shopify.server'

export const EMMA_CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_products',
    description:
      'Search the live xdipx.com catalog. Use this whenever you need to find ' +
      'products to recommend. Returns up to 20 compact product cards with handle, ' +
      'price, tags, and Emma-relevant tags (audience, mood, matters). ' +
      'Always use this before naming a product — never invent SKUs.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Title keyword search, e.g. "wand", "bullet", "couples"' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Shopify tags. Common ones: for-him, for-her, couples, beginner, advanced',
        },
        product_type: {
          type: 'string',
          description: 'Filter by product_type_dial: one of air-pulsation, vibrator, wand, lube, wear',
        },
        price_min: { type: 'number', description: 'USD lower bound (inclusive)' },
        price_max: { type: 'number', description: 'USD upper bound (inclusive)' },
        limit: { type: 'integer', description: 'Default 12, max 20', minimum: 1, maximum: 20 },
      },
    },
  },
  {
    name: 'get_product_details',
    description:
      'Fetch full enrichment for one product by handle: full story, feature ' +
      'bullets, sensation_dial ratings, pairing_why for accessories, variants. ' +
      'Use this after search_products when the user wants depth on a specific pick.',
    input_schema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Shopify product handle (URL slug)' },
      },
      required: ['handle'],
    },
  },
]

export async function executeEmmaChatTool(
  name: string,
  input: Record<string, unknown>,
): Promise<{ content: string; is_error?: boolean }> {
  try {
    if (name === 'search_products') {
      const cards = await searchCatalogForEmma({
        keyword: input.keyword as string | undefined,
        tags: (input.tags as string[]) || undefined,
        productType: input.product_type as string | undefined,
        priceMin: input.price_min as number | undefined,
        priceMax: input.price_max as number | undefined,
        limit: (input.limit as number) ?? 12,
      })
      return { content: JSON.stringify({ count: cards.length, results: cards }) }
    }
    if (name === 'get_product_details') {
      const detail = await getProductDetailForEmma(input.handle as string)
      if (!detail) return { content: JSON.stringify({ error: 'not_found' }), is_error: true }
      return { content: JSON.stringify(detail) }
    }
    return { content: JSON.stringify({ error: 'unknown_tool', name }), is_error: true }
  } catch (err) {
    return {
      content: JSON.stringify({ error: 'tool_execution_failed', message: String(err) }),
      is_error: true,
    }
  }
}
```

#### 3b. `app/lib/emma-chat.server.ts`

Five exported functions:

1. `EMMA_SME_SYSTEM_PROMPT` — multi-paragraph string. Below is the canonical
   text. Do **not** soften it — this is internal.

```ts
export const EMMA_SME_SYSTEM_PROMPT = `
You are Emma, the in-house product expert at xdipx.com — an editorially-curated
sexual-wellness storefront. This is an internal Slack-style chat with the xdipx
team for drafting Reddit replies (mostly r/sextoys). It is NOT customer-facing.

Voice in THIS context (different from public site copy):
- Frank, raw, factual. Talk like a senior product person who has actually tested
  the gear. Profanity is fine when it serves clarity. Em-dashes are fine.
- You can name competitors (Lelo, We-Vibe, Lovense, Magic Wand, Womanizer, Satisfyer,
  Tenga, Fleshlight, etc.) and compare them honestly to xdipx SKUs.
- You can call out overhyped products. You can be opinionated.
- You can discuss anatomy, materials (silicone vs TPE vs ABS vs porous vs nonporous),
  motors (single vs dual, RPM, decibel-level when known), waterproofing, charging,
  noise levels, sizing/girth, and what works/doesn't for which body.
- Do NOT use the heart symbol ♥ in this chat. Skip the public-Emma flourishes
  ("I'll take it ♥", "been living on my desk", etc.) — those are for storefront copy.
- Do NOT use "sex" as an adjective in finished output that the user will paste
  to Reddit — use "intimate", "pleasure", "wellness", or "satisfaction". Internal
  reasoning can be however direct it needs to be.

Catalog grounding (CRITICAL):
- Whenever you would name an xdipx product, FIRST call the search_products tool
  to confirm it exists and get the current handle. Never invent SKUs.
- After search, you MAY call get_product_details for depth on one specific pick.
- When you mention an xdipx product in your reply text, format it as:
  [Product Title](https://xdipx.com/products/{handle})
- That format renders as a Reddit-flavored link the user will copy-paste verbatim.
- For competitor products, do NOT generate links — just name them in plain text.

Reddit reply style:
- Match the energy of the post you were given. Quick question = quick answer.
  Long detailed post = thorough answer.
- Lead with the recommendation, then the why. People scroll.
- If you are unsure, say so. Hype kills credibility.
- Disclose nothing about being AI. Disclose nothing about being from xdipx UNLESS
  the user explicitly asks you to add a disclosure. The user runs the disclosure
  policy, not you.

When the user pastes a Reddit post and asks for a draft, return ONLY the draft —
no preamble, no "here's a draft of:" framing. They want to copy your reply.
`.trim()
```

2. `loadThread(threadId: number)` — fetch thread metadata + ordered messages
   from Neon. Return `null` if not found.

3. `createThread(input: { firstUserMessage: string; redditPostUrl?: string; redditPostExcerpt?: string })` —
   insert a thread row + the first user message row (atomically, via `db.transaction`),
   derive a title (first 80 chars of `firstUserMessage` or `redditPostExcerpt`),
   return the new thread id. Return shape: `{ threadId, messageId }`.

4. `appendUserMessage(threadId: number, content: string)` — insert one message row,
   bump `threads.updated_at`. Return the message id.

5. `streamEmmaReply(input: { threadId: number; signal: AbortSignal })` —
   the orchestrator. Returns `ReadableStream<Uint8Array>` of SSE events:

   - Loads conversation history from DB
   - Maps DB messages → Anthropic message format (role + content blocks; tool_calls
     become `tool_use` blocks; tool_results become `tool_result` blocks in a `user` role)
   - Calls `client.messages.stream({ model, system, tools, messages, max_tokens: 4096 })`
   - Re-emits text deltas as `event: token\ndata: {"text":"…"}\n\n`
   - On `tool_use` stop, runs each tool via `executeEmmaChatTool`, persists an
     `assistant` row (with `tool_calls`) and a `tool` row (with `tool_results`),
     emits `event: tool\ndata: {…}` for each, loops back into another stream call
   - On `end_turn`, persists final assistant content + token counts + latency,
     emits `event: done\ndata: {"messageId":N}\n\n`, closes the stream
   - Hard cap: max 6 tool-use hops per user message. After cap, force `stop`.
   - Aborts cleanly when `signal.aborted`.

   SSE event types: `token`, `tool_call`, `tool_result`, `error`, `done`.

   Reference implementation: copy structure from
   `app/lib/emma-orchestrator.server.ts:745-817` for the loop;
   copy chat-style stop_reason handling from
   `app/lib/ai-agent/chat.server.ts:425-463`.

### Verification

- [ ] `tsc --noEmit` passes.
- [ ] In a quick test script, `createThread({ firstUserMessage: 'test' })` writes
  exactly one thread row and one message row; verify with `SELECT * FROM emma_chat_threads`.
- [ ] Manually invoke `streamEmmaReply({ threadId, signal: new AbortController().signal })`
  with a thread whose first user message is "find me a wand under $80" and confirm:
  - SSE events arrive in order: ≥1 `tool_call` (search_products), ≥1 `tool_result`,
    `token` chunks, `done`.
  - DB has assistant row with `tool_calls` JSON populated, plus a tool row, plus
    a final assistant row with non-null `content` and `stop_reason='end_turn'`.
- [ ] Hard cap: with a deliberately tool-heavy prompt, hop count never exceeds 6.

### Anti-pattern guards

- Do **not** call `client.messages.create()` — use `client.messages.stream()`.
- Do **not** persist assistant content while streaming — accumulate in memory,
  flush on `done` so a partial mid-stream crash doesn't write torn content.
  (Tool calls/results ARE persisted at hop boundaries — those are atomic.)
- Do **not** skip the `tool_use_id` plumbing — Anthropic rejects subsequent
  turns if `tool_result.tool_use_id` doesn't match the prior `tool_use.id`.
- Do **not** leak server-only types through this file's exports — only the five
  functions above and the system prompt constant.
- Do **not** use `useEffect` anywhere (this is a `.server.ts` file but stating
  the rule for completeness — the consuming UI must also avoid it).

---

## Phase 4 — Streaming Endpoint

**Owner:** delegate to `rr7-engineer` agent.

### What to implement

`app/routes/api.admin.emma-chat.stream.$threadId.tsx`

```ts
import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { streamEmmaReply } from '~/lib/emma-chat.server'

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const threadId = Number(params.threadId)
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return new Response('bad threadId', { status: 400 })
  }
  const stream = streamEmmaReply({ threadId, signal: request.signal })
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no', // prevent intermediate buffering on Vercel
    },
  })
}
```

The flow: client posts a user message via the `admin.emma-chat.$threadId` action,
then opens an `EventSource('/api/admin/emma-chat/stream/{threadId}')` to get the
assistant reply token-by-token.

### Verification

- [ ] `curl -N -H "Cookie: __xdipx_admin=…" http://localhost:3000/api/admin/emma-chat/stream/1`
  returns a `text/event-stream` response with `event: token`/`event: done` frames.
- [ ] Without a valid admin cookie, the same curl returns a redirect to `/admin/login`
  (because `requireAdmin` throws).
- [ ] `request.signal.aborted` propagates: closing the curl session cancels the
  Anthropic stream within 1s (no orphan API calls visible in logs).

### Anti-pattern guards

- Do **not** wrap the stream in JSON. SSE has its own framing.
- Do **not** swallow abort signals — pass `request.signal` through to
  `streamEmmaReply` and onward to `client.messages.stream({ signal })`.
- Do **not** add `Access-Control-Allow-Origin: *` — admin only, same-origin.

---

## Phase 5 — Admin Routes + UI

**Owner:** delegate to `rr7-engineer` agent.

### What to implement

#### 5a. `app/routes/admin.emma-chat.tsx` — thread list

Loader: `requireAdmin`, then
`db.select().from(emmaChatThreads).where(eq(archived, false)).orderBy(desc(updatedAt)).limit(50)`.

Action with intent `create`: requires fields `firstUserMessage` (textarea),
optional `redditPostUrl`, optional `redditPostExcerpt`. Calls `createThread()`,
returns redirect to `/admin/emma-chat/{threadId}`.

UI:
- Header: "Emma Chat" + small subtitle ("Internal SME for drafting replies").
- `<NewThreadForm>` at top: collapsible card. Reddit URL input, paste-the-post
  textarea (4–8 rows), composer textarea ("What do you want to ask Emma?"),
  submit button labeled "Start thread". Submits via `fetcher.Form`.
- Below: list of threads. Each row: title, "asked X ago" timestamp, count of
  messages, link to thread page. Archive button per row (intent `archive`).
- Empty state: friendly nudge with example prompt.

#### 5b. `app/routes/admin.emma-chat.$threadId.tsx` — chat page

Loader: `requireAdmin`, then load thread + messages via `loadThread()`.
Throw 404 if not found.

Action with intent `send`: requires field `content`. Calls `appendUserMessage()`.
Returns `{ ok: true, messageId }` so the client can flip to streaming mode.

Action with intent `quick_action`: requires field `action` (one of
`more_direct | shorter | competitor_compare | safety_disclaimer | more_emma`).
Resolves to a canned user-message string and calls `appendUserMessage()` with
that text. (We append as a real user turn rather than a hidden directive so the
conversation stays inspectable.)

Action with intent `archive`: sets `archived=true`, redirects to list.

UI (this is the meat — components in `app/components/admin/EmmaChat/`):
- Header: thread title + Reddit URL link (opens new tab) + archive button.
- If `redditPostExcerpt` is set, show it in a quoted card at top: "📋 Post you're replying to".
- Scrollable message list:
  - User messages: right-aligned, `bg-cream-2` bubble, `text-ink` foreground.
  - Assistant messages: left-aligned, `bg-paper` bubble with `border-line`,
    rendered through a small markdown component (use a tiny inline renderer
    or `react-markdown` if already installed; verify in package.json before adding).
  - Tool messages: collapsed by default behind a `<details>` ("Searched catalog: 4 results").
    Expanding shows the JSON pretty-printed.
- Last assistant message gets:
  - A `<CopyButton>` ("Copy reply") that copies the markdown source to clipboard.
  - A `<QuickActions>` row with five buttons:
    `[More direct] [Shorter] [Add competitor compare] [Add safety disclaimer] [More Emma personality]`
- Composer at bottom: textarea + "Send" button (Cmd+Enter submits). Disabled
  while a stream is open.

Streaming integration (the tricky bit):
- On submit (intent `send`), the action persists the user message and returns
  `{ ok, messageId }`.
- A small client-side hook (`useEmmaStream(threadId)`) opens an `EventSource`
  to `/api/admin/emma-chat/stream/{threadId}` whenever a `send` action just
  resolved. It accumulates `token` events into a local `streamingDraft` state,
  appends `tool_call` / `tool_result` events to a local `streamingTools` array.
  On `done`, it triggers a `useFetcher` revalidation so the loader re-runs and
  pulls the persisted assistant message from DB. The local draft is then cleared.
- Auto-scroll to bottom on new tokens.

Quick-action canned strings (defined in `emma-chat.server.ts`, exported):
- `more_direct`: "Make that more direct. Cut the warmup. Lead with the rec."
- `shorter`: "Shorter. Half the length. Reddit doesn't read essays."
- `competitor_compare`: "Add a quick comparison to a competitor product or two."
- `safety_disclaimer`: "Add a brief safety/material note (silicone, body-safe, etc.) where relevant."
- `more_emma`: "More Emma personality. Funnier, warmer, less corporate."

#### 5c. `app/components/admin/EmmaChat/`

Five components, one file each. All client-safe (no `.server` imports).

- `ChatMessage.tsx` — renders a single message row by role.
- `ChatComposer.tsx` — textarea + send. Cmd+Enter submits. Uses `useFetcher`.
- `QuickActions.tsx` — five-button row. Each button is a `useFetcher` form post.
- `CopyButton.tsx` — `navigator.clipboard.writeText` + 2s "Copied!" feedback.
- `NewThreadForm.tsx` — first-message form on the list page.

#### 5d. `app/components/admin/AdminNav.tsx` — add nav entry

Insert into `NAV_ITEMS` (between Labs and Settings is fine):
```ts
{ to: '/admin/emma-chat', label: 'Emma Chat', Icon: ChatBubbleIcon },
```

Add a 16×16 stroke `ChatBubbleIcon` matching the existing icon style at the
top of that file.

### Verification

- [ ] `npm run typecheck` passes.
- [ ] Visit `/admin/emma-chat` while logged out → redirected to `/admin/login`.
- [ ] Visit `/admin/emma-chat` while logged in → empty state renders.
- [ ] Submit a new thread with a real Reddit-style prompt
  ("Looking for a quiet wand under $80, anyone tried the Magic Wand Mini?") →
  redirected to `/admin/emma-chat/{id}`. Assistant streams back. At least one
  xdipx product appears as `[Title](https://xdipx.com/products/handle)`. Tool
  calls show up collapsed under `<details>`.
- [ ] "Copy reply" copies the assistant's markdown source verbatim.
- [ ] All five quick-action buttons produce a follow-up user message + new
  assistant reply.
- [ ] Archive button works, thread disappears from list.
- [ ] Mobile width (375px) — composer + last message both visible, scroll works.

### Anti-pattern guards

- Do **not** fetch data with `useEffect`. Loader-only.
- Do **not** import any `.server.ts` from a component file.
- Do **not** install `react-markdown` if there's already a markdown helper in
  the repo — grep first. If we must add it, prefer the smallest viable lib
  (`marked` or a hand-rolled subset that handles `**bold**`, `*italic*`,
  `[text](url)`, `\n\n` paragraph breaks, lists). The output is admin-internal,
  not user-facing.
- Do **not** sanitize/strip the markdown links before display — they need to be
  copy-pasteable verbatim.

---

## Phase 6 — Architecture Review

**Owner:** delegate to `tech-architect` agent.

### What to verify

After Phase 5 lands, ask `tech-architect` to review:

1. **Oxygen migration seam preserved**: every Shopify call still flows through
   `app/lib/shopify.server.ts`. No direct GraphQL in `emma-chat.server.ts`.
2. **`.server.ts` boundary**: `app/components/admin/EmmaChat/*.tsx` does not
   import from any `.server.ts` file (run `grep -rn "\.server" app/components/admin/EmmaChat/`).
3. **Loader/action discipline**: chat page never fetches data via `useEffect`.
   Streaming is via SSE, which is route-action-adjacent (separate API route),
   not data fetching.
4. **Admin-only**: every mutating route does `await requireAdmin(request)` first.
5. **No PII leak through tool results**: tool results store only product card
   data (no customer GIDs, IPs, etc.) — confirm by inspecting the JSONB columns.
6. **Token budget guardrails**: the orchestrator's 6-hop cap is enforced and
   logged. `max_tokens: 4096` is the only output cap.
7. **No regressions in agent voice elsewhere**: confirm `app/lib/claude.server.ts`
   and `app/lib/sms-v2/*` system prompts were NOT modified by this work.

Tech-architect should produce a short ADR at `.planning/emma-chat/ADR-001-streaming-pattern.md`
documenting the SSE choice (since this is the first streaming-to-browser route
in the repo) so future features can copy the pattern.

### Verification

- [ ] ADR exists and explains: SSE vs WebSocket, why no Vercel AI SDK, abort-signal flow.
- [ ] Tech-architect signs off in writing on the file boundaries.

---

## Phase 7 — QA + Sign-off

**Owner:** delegate to `qa-reviewer` agent.

### What to verify

Standard verify-before-merge sweep:

1. **Type check**: `npm run typecheck`.
2. **Build**: `npm run build` succeeds, `build/server/index.js` artifact exists.
   (Memory ID 2371 flags this as a recurring Vercel deploy failure mode.)
3. **Tests**: `npm test` if applicable (project has Vitest in some areas — check).
4. **Preview-MCP smoke test** of the full happy path:
   - Login as admin.
   - Create a new thread with a multi-paragraph Reddit post.
   - Confirm tool calls fire (check network tab: SSE stream shows tool events).
   - Confirm at least one xdipx product link appears, opens to a real PDP.
   - Click "Copy reply", paste into a text field, confirm exact markdown.
   - Click each of the 5 quick actions, confirm follow-up reply per click.
   - Archive thread, confirm it disappears from list.
5. **DB cleanup**: leftover test threads can be left in dev; in production, the
   archive flag is enough — no hard delete from UI in v1.
6. **Mobile (375px) regression**: chat page renders, composer reachable, no
   horizontal scroll.

### Verification

- [ ] qa-reviewer produces a checklist with PASS for every step above.
- [ ] Any FAIL gets fixed before merge.

---

## Open Questions for Mike (resolve before Phase 1)

These were assumed during planning. Confirm or correct, then start Phase 1:

1. **Schema PK type** — I switched the original spec from UUID to SERIAL to match
   the existing `emma_chat_sessions`/`emma_chat_turns` precedent. Is that right,
   or do you specifically want UUIDs for these tables?

2. **Streaming approach** — the codebase has zero streaming-to-browser today.
   Plan goes with manual SSE (no new deps). Alternative would be installing
   `ai` (Vercel AI SDK ~30KB) for a more standard pattern. SSE is my
   recommendation. Confirm?

3. **Reddit URL field** — keeping it optional (paste a URL OR paste post text OR both).
   Sound right?

4. **Quick actions** — the five proposed are: More direct / Shorter / Add competitor
   compare / Add safety disclaimer / More Emma personality. Want any added or
   removed before build?

5. **Markdown renderer** — confirm I should grep first before adding a dep. If
   no helper exists, OK to add a tiny renderer (no `react-markdown`)?

6. **Voice profanity in actual replies** — system prompt says profanity is fine
   for *internal reasoning*, but for the draft itself I assumed Reddit-appropriate
   (occasional swear OK, no slurs, nothing that'd auto-filter on r/sextoys).
   Confirm.

7. **Disclosure policy** — system prompt says Emma never discloses being from
   xdipx unless the user explicitly asks. Confirm. (We may want a 6th quick
   action: "Add xdipx disclosure" — easy to add.)

---

## Execution Order

1. Mike confirms open questions above.
2. **Phase 1** (DB + schema) — primary agent, ~15 min.
3. **Phase 2** (Shopify helpers) — `shopify-ops` agent, ~30 min.
4. **Phase 3** (server lib + tools) — primary agent, ~60 min. **Most complex phase.**
5. **Phase 4** (streaming endpoint) — `rr7-engineer`, ~15 min.
6. **Phase 5** (admin routes + UI) — `rr7-engineer`, ~90 min.
7. **Phase 6** (architecture review) — `tech-architect`, ~20 min, may produce
   change requests that loop back to Phase 5.
8. **Phase 7** (QA) — `qa-reviewer`, ~30 min including preview MCP smoke test.

Total estimated wall-clock: ~4 hours, much of it in parallel where phases
don't depend on each other (Phase 2 and Phase 1 can run in parallel; Phase 5
components can be built in parallel).
