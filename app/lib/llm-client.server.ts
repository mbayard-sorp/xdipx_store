/**
 * Small abstraction over the orchestrator's `messages.create({ tools, messages })`
 * call so the same orchestrator code can be driven by either:
 *
 *   - the **Anthropic SDK** (production importer — billed against ANTHROPIC_API_KEY),
 *   - or the **Claude Agent SDK** (one-time backfill — billed against your Max
 *     subscription via the local `claude` CLI session).
 *
 * Production behavior is unchanged: callers that don't pass an explicit client
 * keep using the SDK path via the default `getDefaultClient()`. The backfill
 * script picks `--via=api|claude-code` and constructs the client accordingly.
 *
 * This file is a thin adapter — the interesting logic is still in the
 * orchestrator. Goal: zero risk to the live import path.
 */
import Anthropic from '@anthropic-ai/sdk'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnthropicTool = any

// Anthropic content blocks — keep this loose so we don't fight the SDK's
// vendor-versioned message shape. The orchestrator only inspects `.type`,
// `.id`, `.name`, `.input` on tool_use and pushes the array through verbatim.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnthropicContent = any

export interface LLMMessage {
  role:    'user' | 'assistant'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any
}

export interface LLMRequest {
  model:      string
  max_tokens: number
  system:     string
  tools:      AnthropicTool[]
  messages:   LLMMessage[]
  /** Optional call-site metadata forwarded to logApiTokens. Not sent to the API. */
  meta?: {
    feature:   string
    source?:   'sync' | 'batch'
    caller?:   string
    productId?: string
    sku?:      string
  }
}

export interface LLMResponse {
  content:     AnthropicContent[]
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | string | null
  usage: {
    input_tokens:                number
    output_tokens:               number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?:     number
  }
}

/** Stable surface that the orchestrator depends on. */
export interface LLMClient {
  /** Identifier for telemetry / logs. */
  readonly via: 'api' | 'claude-code'
  create(req: LLMRequest): Promise<LLMResponse>
}

// ─── AnthropicSdkClient — production path (default) ──────────────────────────

export class AnthropicSdkClient implements LLMClient {
  readonly via = 'api' as const
  private readonly client: Anthropic

  constructor(opts?: { apiKey?: string }) {
    this.client = new Anthropic({
      ...(opts?.apiKey ? { apiKey: opts.apiKey } : { apiKey: process.env['ANTHROPIC_API_KEY']?.trim() }),
    })
  }

  async create(req: LLMRequest): Promise<LLMResponse> {
    const res = await this.client.messages.create({
      model:      req.model,
      max_tokens: req.max_tokens,
      // Cache the static prefix (tools + system) so repeated turns re-read it
      // instead of re-billing at full input rate. Canonical cache order is
      // tools → system → messages, so this single breakpoint covers both.
      system:     [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      tools:      req.tools,
      messages:   req.messages,
    })
    // Extend usage cast to include cache fields (B3.0).
    const u = res.usage as {
      input_tokens:                number
      output_tokens:               number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?:     number
    }
    // B3.1 — best-effort token log. `void` ensures a logging failure never
    // unwinds the real API call. The `meta` field is stripped before the API
    // request above; it is only used here for attribution.
    void import('./token-log.server').then(({ logApiTokens }) => {
      const entry: import('./token-log.server').TokenLogEntry = {
        feature:             req.meta?.feature  ?? 'enrichment',
        model:               req.model,
        source:              req.meta?.source   ?? 'sync',
        inputTokens:         u.input_tokens,
        outputTokens:        u.output_tokens,
        cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadTokens:     u.cache_read_input_tokens     ?? 0,
      }
      if (req.meta?.caller)    entry.caller    = req.meta.caller
      if (req.meta?.productId) entry.productId = req.meta.productId
      if (req.meta?.sku)       entry.sku       = req.meta.sku
      return logApiTokens(entry)
    }).catch((err) => console.error('[llm-client] token-log import failed (ignored):', err))
    return {
      content:     res.content as AnthropicContent[],
      stop_reason: (res as { stop_reason?: string | null }).stop_reason ?? null,
      usage: {
        input_tokens:                u.input_tokens,
        output_tokens:               u.output_tokens,
        ...(u.cache_creation_input_tokens !== undefined
          ? { cache_creation_input_tokens: u.cache_creation_input_tokens }
          : {}),
        ...(u.cache_read_input_tokens !== undefined
          ? { cache_read_input_tokens: u.cache_read_input_tokens }
          : {}),
      },
    }
  }
}

// ─── ClaudeAgentSdkClient — Max-subscription routing marker ──────────────────

/**
 * Marker class signalling the orchestrator should route via the Agent SDK
 * path (`runOrchestrationViaSdk` in emma-orchestrator.server.ts) instead of
 * driving an API-style turn loop. The Agent SDK manages turns + tool dispatch
 * itself via its in-process MCP server protocol, which doesn't fit the
 * `LLMClient.create(req)→LLMResponse` shape.
 *
 * The orchestrator branches on `llm.via === 'claude-code'` BEFORE calling
 * `create()`, so this method should never run. It throws if it does — that
 * indicates a routing bug, not a normal code path.
 */
export class ClaudeAgentSdkClient implements LLMClient {
  readonly via = 'claude-code' as const

  async create(_req: LLMRequest): Promise<LLMResponse> {
    throw new Error(
      'ClaudeAgentSdkClient.create() must not be called — orchestrator should branch on `via === "claude-code"` and use runOrchestrationViaSdk instead.',
    )
  }
}

/**
 * Dynamic-imports the Agent SDK and returns the helpers used by the
 * orchestrator's claude-code path. Kept dynamic so the production bundle
 * doesn't pull `@anthropic-ai/claude-agent-sdk` in unless the backfill
 * actually opts into `--via=claude-code`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadAgentSdk(): Promise<{ query: any; tool: any; createSdkMcpServer: any }> {
  // Indirect dynamic import so TS doesn't require the package at build time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-implied-eval
  const dynImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk = await dynImport('@anthropic-ai/claude-agent-sdk').catch(() => null) as any
  if (!sdk) throw new Error('install @anthropic-ai/claude-agent-sdk to use --via=claude-code')
  if (typeof sdk.query !== 'function') throw new Error('@anthropic-ai/claude-agent-sdk has no `query` export — SDK shape changed')
  if (typeof sdk.tool !== 'function') throw new Error('@anthropic-ai/claude-agent-sdk has no `tool` export — SDK shape changed')
  if (typeof sdk.createSdkMcpServer !== 'function') throw new Error('@anthropic-ai/claude-agent-sdk has no `createSdkMcpServer` export — SDK shape changed')
  return { query: sdk.query, tool: sdk.tool, createSdkMcpServer: sdk.createSdkMcpServer }
}

/**
 * Single-turn Claude call routed through the Agent SDK / Max subscription.
 *
 * The SDK's `query()` is built for tool-using agents; for non-tool generators
 * (the per-tool content generators in `claude.server.ts`) we just want the
 * model's text output to one prompt. This wraps that pattern: no MCP server,
 * no tools, `maxTurns: 1`, walk the stream, return the assistant's text + any
 * usage that comes back on the assistant message.
 *
 * Returns:
 *   - `text`: concatenated text blocks from the assistant message(s)
 *   - `inputTokens` / `outputTokens`: from `assistant.message.usage` if surfaced
 *
 * The SDK ignores the `model` option (Claude Code uses the subscription's
 * default Sonnet). `maxTokens` is forwarded as a budget hint where supported.
 */
export async function runSingleClaudeCallViaSdk(opts: {
  system:    string
  prompt:    string
  maxTokens: number
  model?:    string
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const { query } = await loadAgentSdk()

  let text = ''
  let inputTokens  = 0
  let outputTokens = 0

  const stream = query({
    prompt: opts.prompt,
    options: {
      systemPrompt: opts.system,
      tools:        [],   // disable all built-in tools (Bash/Read/etc.)
      maxTurns:     1,    // single round-trip, like client.messages.create
    },
  })

  for await (const event of stream) {
    if (!event || typeof event !== 'object') continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ev = event as any
    if (ev.type === 'assistant') {
      // Pull text blocks out of the assistant's BetaMessage.content[]
      const blocks = ev.message?.content
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            text += block.text
          }
        }
      }
      const usage = ev.message?.usage
      if (usage) {
        inputTokens  += Number(usage.input_tokens  ?? 0)
        outputTokens += Number(usage.output_tokens ?? 0)
      }
    } else if (ev.type === 'result') {
      // SDK terminates here.
      break
    }
  }

  return { text, inputTokens, outputTokens }
}

// ─── Default + factory ──────────────────────────────────────────────────────

let _default: LLMClient | null = null
/** Lazy singleton — reused by the production import flow. */
export function getDefaultClient(): LLMClient {
  if (!_default) _default = new AnthropicSdkClient()
  return _default
}

export function makeLLMClient(via: 'api' | 'claude-code'): LLMClient {
  return via === 'claude-code' ? new ClaudeAgentSdkClient() : new AnthropicSdkClient()
}
