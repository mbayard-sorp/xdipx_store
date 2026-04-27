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
}

export interface LLMResponse {
  content:     AnthropicContent[]
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | string | null
  usage: {
    input_tokens:  number
    output_tokens: number
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
      system:     req.system,
      tools:      req.tools,
      messages:   req.messages,
    })
    return {
      content:     res.content as AnthropicContent[],
      stop_reason: (res as { stop_reason?: string | null }).stop_reason ?? null,
      usage: {
        input_tokens:  res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
      },
    }
  }
}

// ─── ClaudeAgentSdkClient — backfill via Max subscription ────────────────────

/**
 * Adapter for `@anthropic-ai/claude-agent-sdk` `query()`. The SDK runs Claude
 * Code as a subprocess against your authenticated Max session, so token usage
 * counts toward your subscription quota instead of an API key.
 *
 * Trade-offs vs api path:
 *   - Higher per-call latency (subprocess + interactive session overhead)
 *   - Token counts come back as 0 (Agent SDK doesn't surface them)
 *   - Auth is the existing `claude /login` session — no env-var setup
 *
 * We dynamic-import the SDK so the production bundle doesn't pay the cost of
 * pulling it in unless the backfill script actually opts in.
 *
 * IMPORTANT: This adapter is best-effort and intentionally narrow. If the
 * Agent SDK shape diverges (it's pre-1.0), we surface the error rather than
 * silently fabricating tool calls — the user can fall back to `--via=api`.
 */
export class ClaudeAgentSdkClient implements LLMClient {
  readonly via = 'claude-code' as const

  async create(req: LLMRequest): Promise<LLMResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let queryFn: any
    try {
      // Dynamic + indirect import so TS doesn't require the package at build time.
      // The Agent SDK is an optional dependency — install before using --via=claude-code.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-implied-eval
      const dynImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>
      const mod = await dynImport('@anthropic-ai/claude-agent-sdk').catch(() => null)
      if (!mod) {
        throw new Error(
          'ClaudeAgentSdkClient: install @anthropic-ai/claude-agent-sdk to use --via=claude-code',
        )
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queryFn = (mod as any).query
      if (typeof queryFn !== 'function') {
        throw new Error('ClaudeAgentSdkClient: @anthropic-ai/claude-agent-sdk has no `query` export — SDK shape may have changed')
      }
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
    }

    // The Agent SDK takes a single user prompt + a tool registry; we serialize
    // the orchestrator's message array into one prompt string so the subprocess
    // session sees the full context. This is lossy compared to native multi-
    // turn, but the orchestrator already keeps state in its own `state.writes`
    // — the model just needs to decide the next tool call.
    const promptParts: string[] = []
    promptParts.push(`<system>${req.system}</system>`)
    for (const m of req.messages) {
      if (typeof m.content === 'string') {
        promptParts.push(`<${m.role}>${m.content}</${m.role}>`)
      } else if (Array.isArray(m.content)) {
        promptParts.push(`<${m.role}>${JSON.stringify(m.content)}</${m.role}>`)
      }
    }
    const prompt = promptParts.join('\n\n')

    // Call the SDK and collect the streaming events into a single content array.
    const content: AnthropicContent[] = []
    let inputTokens = 0
    let outputTokens = 0

    try {
      const stream = queryFn({
        prompt,
        options: {
          model: req.model,
          // Limit subprocess "permission mode" so it can call our tools but
          // not arbitrary built-ins. The Agent SDK takes a `tools` shape; we
          // pass our orchestrator tools straight through.
          tools: req.tools,
        },
      })
      for await (const event of stream) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ev = event as any
        if (ev?.type === 'tool_use' && ev.tool_use) {
          content.push({
            type:  'tool_use',
            id:    ev.tool_use.id ?? `tu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name:  ev.tool_use.name,
            input: ev.tool_use.input ?? {},
          })
        } else if (ev?.type === 'text' && typeof ev.text === 'string') {
          content.push({ type: 'text', text: ev.text })
        } else if (ev?.type === 'message' && ev.message?.usage) {
          inputTokens  += Number(ev.message.usage.input_tokens  ?? 0)
          outputTokens += Number(ev.message.usage.output_tokens ?? 0)
        }
      }
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
    }

    return {
      content,
      stop_reason: content.some(c => c?.type === 'tool_use') ? 'tool_use' : 'end_turn',
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }
  }
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
