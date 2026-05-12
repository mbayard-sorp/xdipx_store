import crypto from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { kvGet, kvSet } from './kv.server'

export interface MarkupSuggestion {
  productType: string
  highMarginDiscount: number
  mediumMarginDiscount: number
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
          highMarginDiscount: { type: 'number', minimum: 0, maximum: 0.6 },
          mediumMarginDiscount: { type: 'number', minimum: 0, maximum: 0.6 },
          rationale: { type: 'string' },
        },
        required: ['productType', 'highMarginDiscount', 'mediumMarginDiscount', 'rationale'],
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

function clampDiscount(v: unknown): number | null {
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') {
    const parsed = parseFloat((v as string).replace('%', '').trim())
    if (isNaN(parsed)) return null
    // Tolerate models that return whole-number percents like "35" instead of 0.35
    n = parsed > 1 ? parsed / 100 : parsed
  } else return null
  if (isNaN(n)) return null
  return Math.min(0.6, Math.max(0, n))
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
    const high = clampDiscount(obj['highMarginDiscount'])
    const medium = clampDiscount(obj['mediumMarginDiscount'])
    if (high === null) { rejectedReasons.push(`${pt}: bad highMarginDiscount (${JSON.stringify(obj['highMarginDiscount'])})`); continue }
    if (medium === null) { rejectedReasons.push(`${pt}: bad mediumMarginDiscount (${JSON.stringify(obj['mediumMarginDiscount'])})`); continue }
    const rationale = typeof obj['rationale'] === 'string' ? (obj['rationale'] as string).trim() : ''
    suggestions.push({
      productType: pt,
      highMarginDiscount: high,
      mediumMarginDiscount: medium,
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
  globalHighDiscount: number
  globalMediumDiscount: number
  bypassCache?: boolean
}): Promise<SuggestResult> {
  const { types, globalHighDiscount, globalMediumDiscount, bypassCache } = opts

  if (types.length === 0) return { suggestions: [] }

  const key = cacheKey(types)
  if (!bypassCache) {
    const cached = await kvGet<MarkupSuggestion[]>(key)
    if (cached && cached.length > 0) return { suggestions: cached }
  }

  const typeList = types.map(t => `- ${t.productType} (${t.count} products)`).join('\n')

  const system = [
    'You are a pricing strategist for xdipx.com, an editorially-curated sexual-wellness storefront.',
    'Context: 20% margin floor. Building brand share. Generous pricing is OK. Not a luxury brand.',
    `Current global discounts: high-margin products ${Math.round(globalHighDiscount * 100)}% off MSRP, medium-margin products ${Math.round(globalMediumDiscount * 100)}% off MSRP.`,
    'Your job: suggest per product-type discount percentages that maximise deal appeal while respecting the margin floor.',
    'Rules:',
    '- highMarginDiscount and mediumMarginDiscount are decimal fractions (e.g. 0.35 = 35%).',
    '- Values must be between 0.0 and 0.6.',
    '- Rationale must be a single sentence, plain English, no em-dashes.',
    '- You MUST call the emit_markup_suggestions tool. Do not output prose or JSON outside the tool call.',
  ].join('\n')

  const userMessage = [
    'Suggest discount settings for these product types:',
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
