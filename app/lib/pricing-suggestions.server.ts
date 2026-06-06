import crypto from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { kvGet, kvSet } from './kv.server'
import { logApiTokens } from './token-log.server'

export interface MarkupSuggestion {
  productType: string
  /** V2: target margin as a decimal fraction, e.g. 0.45 = 45% margin */
  targetMarginPct: number
  /** V2: margin floor as a decimal fraction, e.g. 0.20 = 20% margin */
  marginFloorPct: number
  rationale: string
}

const SUGGESTION_TTL = 3600 // 1 hour

const TOOL_NAME = 'emit_markup_suggestions'

// Input schema for the forced tool call
const TOOL_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          productType: { type: 'string' },
          targetMarginPct: { type: 'number', minimum: 0.10, maximum: 0.75 },
          marginFloorPct: { type: 'number', minimum: 0.10, maximum: 0.60 },
          rationale: { type: 'string' },
        },
        required: ['productType', 'targetMarginPct', 'marginFloorPct', 'rationale'],
      },
    },
  },
  required: ['suggestions'],
}

function cacheKey(types: Array<{ productType: string; count: number }>): string {
  const sorted = [...types].sort((a, b) => a.productType.localeCompare(b.productType))
  const hash = crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16)
  return `pricing:markup-suggestions:${hash}`
}

function clampMargin(v: unknown, lo = 0.10, hi = 0.75): number | null {
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') {
    const parsed = parseFloat((v as string).replace('%', '').trim())
    if (isNaN(parsed)) return null
    // Tolerate models that return whole-number percents like "45" instead of 0.45
    n = parsed > 1 ? parsed / 100 : parsed
  } else return null
  if (isNaN(n)) return null
  return Math.min(hi, Math.max(lo, n))
}

interface ValidatedSuggestions {
  suggestions: MarkupSuggestion[]
  rejectedReasons: string[]
}

function validateToolInput(input: unknown): ValidatedSuggestions {
  const suggestions: MarkupSuggestion[] = []
  const rejectedReasons: string[] = []

  if (!input || typeof input !== 'object') {
    rejectedReasons.push('tool input was not an object')
    return { suggestions, rejectedReasons }
  }

  const raw = input as Record<string, unknown>
  const items = raw['suggestions']
  if (!Array.isArray(items)) {
    rejectedReasons.push('tool input.suggestions was not an array')
    return { suggestions, rejectedReasons }
  }

  for (const item of items) {
    if (!item || typeof item !== 'object') { rejectedReasons.push('non-object item'); continue }
    const obj = item as Record<string, unknown>
    const pt = typeof obj['productType'] === 'string' ? (obj['productType'] as string).trim() : null
    if (!pt) { rejectedReasons.push('missing productType'); continue }
    const target = clampMargin(obj['targetMarginPct'], 0.10, 0.75)
    const floor = clampMargin(obj['marginFloorPct'], 0.10, 0.60)
    if (target === null) { rejectedReasons.push(`${pt}: bad targetMarginPct (${JSON.stringify(obj['targetMarginPct'])})`); continue }
    if (floor === null) { rejectedReasons.push(`${pt}: bad marginFloorPct (${JSON.stringify(obj['marginFloorPct'])})`); continue }
    const rationale = typeof obj['rationale'] === 'string' ? (obj['rationale'] as string).trim() : ''
    suggestions.push({
      productType: pt,
      targetMarginPct: target,
      marginFloorPct: floor,
      rationale: rationale || '(no rationale provided)',
    })
  }

  return { suggestions, rejectedReasons }
}

export interface SuggestResult {
  suggestions: MarkupSuggestion[]
  debug?: {
    rawLength: number
    parsedCount: number
    rejectedCount: number
    rejectedReasons: string[]
    rawPreview: string
    error?: string
  }
}

type AnthropicMessage = Anthropic.Messages.MessageParam

async function callClaude(
  client: Anthropic,
  messages: AnthropicMessage[],
  system: string,
): Promise<{ toolInput: unknown; rawPreview: string }> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system,
    messages,
    tools: [
      {
        name: TOOL_NAME,
        description: 'Emit the markup suggestions array. You MUST call this tool. Do not produce prose.',
        input_schema: TOOL_INPUT_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: TOOL_NAME },
  })

  const u = response.usage as {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
  void logApiTokens({
    feature: 'pricing-suggestions',
    model: 'claude-sonnet-4-20250514',
    source: 'sync',
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    caller: 'callClaude',
  })

  const rawPreview = JSON.stringify(response.content).slice(0, 600)

  const toolBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME,
  )

  if (!toolBlock) {
    throw new Error(`No ${TOOL_NAME} tool_use block in response. stop_reason=${response.stop_reason}`)
  }

  return { toolInput: toolBlock.input, rawPreview }
}

export async function suggestMarkupsByType(opts: {
  types: Array<{ productType: string; count: number }>
  globalTargetMarginPct: number
  globalMarginFloorPct: number
  bypassCache?: boolean
}): Promise<SuggestResult> {
  const { types, globalTargetMarginPct, globalMarginFloorPct, bypassCache } = opts

  if (types.length === 0) return { suggestions: [] }

  const key = cacheKey(types)
  if (!bypassCache) {
    const cached = await kvGet<MarkupSuggestion[]>(key)
    if (cached && cached.length > 0) return { suggestions: cached }
  }

  const typeList = types.map(t => `- ${t.productType} (${t.count} products)`).join('\n')

  const system = [
    'You are a pricing strategist for xdipx.com, an editorially-curated sexual-wellness storefront.',
    'Context: target-margin pricing model. Not a luxury brand. Building brand share.',
    `Current global settings: target margin ${Math.round(globalTargetMarginPct * 100)}%, margin floor ${Math.round(globalMarginFloorPct * 100)}%.`,
    'Your job: suggest per product-type target margin and margin floor percentages.',
    'Rules:',
    '- targetMarginPct is the desired gross margin (e.g. 0.45 = 45%). Range: 0.10 to 0.75.',
    '- marginFloorPct is the minimum acceptable gross margin. Range: 0.10 to 0.60. Must be <= targetMarginPct.',
    '- Values are decimal fractions, not whole numbers.',
    '- Rationale must be a single sentence, plain English, no em-dashes.',
    '- You MUST call the emit_markup_suggestions tool. Do not output prose or JSON outside the tool call.',
  ].join('\n')

  const userMessage = [
    'Suggest target margin settings for these product types:',
    typeList,
    '',
    'Call the emit_markup_suggestions tool with one entry per product type listed above.',
    'Every type listed above MUST appear in the output exactly as written, including punctuation and capitalization.',
    'Keep each rationale under 60 characters.',
  ].join('\n')

  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })
  const messages: AnthropicMessage[] = [{ role: 'user', content: userMessage }]

  let toolInput: unknown
  let rawPreview = ''

  // First attempt
  try {
    const result = await callClaude(client, messages, system)
    toolInput = result.toolInput
    rawPreview = result.rawPreview
  } catch (err) {
    const firstErrMsg = err instanceof Error ? err.message : String(err)
    console.warn('[pricing-suggestions] First attempt failed:', firstErrMsg)

    // Retry once with a nudge appended
    const retryMessages: AnthropicMessage[] = [
      { role: 'user', content: userMessage },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'I need to use the tool.' }],
      },
      {
        role: 'user',
        content: 'Your last response was not valid. Output only via the emit_markup_suggestions tool.',
      },
    ]

    try {
      const retryResult = await callClaude(client, retryMessages, system)
      toolInput = retryResult.toolInput
      rawPreview = retryResult.rawPreview
    } catch (retryErr) {
      const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
      console.error('[pricing-suggestions] Retry also failed:', retryErrMsg)
      return {
        suggestions: [],
        debug: {
          rawLength: 0,
          parsedCount: 0,
          rejectedCount: 0,
          rejectedReasons: [],
          rawPreview: rawPreview || '',
          error: `First attempt: ${firstErrMsg}. Retry: ${retryErrMsg}`,
        },
      }
    }
  }

  // Validate the tool input (already parsed JSON object, no JSON.parse needed)
  const { suggestions, rejectedReasons } = validateToolInput(toolInput)

  console.log(`[pricing-suggestions] accepted=${suggestions.length} rejected=${rejectedReasons.length}`)

  if (suggestions.length > 0) {
    await kvSet(key, suggestions, SUGGESTION_TTL)
  }

  return {
    suggestions,
    debug: {
      rawLength: rawPreview.length,
      parsedCount: suggestions.length + rejectedReasons.length,
      rejectedCount: rejectedReasons.length,
      rejectedReasons,
      rawPreview,
    },
  }
}
