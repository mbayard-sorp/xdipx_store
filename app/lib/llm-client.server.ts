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
