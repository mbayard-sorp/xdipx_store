// Rates are per 1M tokens, in USD, at SYNC (full) price.
// Batch source = 50% of these. Cache write = 1.25x input. Cache read = 0.10x input.
// agent-sdk calls are billed against the Max subscription, not the API key; cost = 0.

type Rate = { input: number; output: number }

const RATES: Record<string, Rate> = {
  'claude-sonnet-4-20250514':  { input: 3,   output: 15 },
  'claude-sonnet-4-6':         { input: 3,   output: 15 }, // legacy alias used by ai-agent/chat
  'claude-haiku-4-5-20251001': { input: 1,   output: 5  },
}

const DEFAULT_RATE: Rate = { input: 3, output: 15 } // unknown model -> assume Sonnet

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
    args.inputTokens         * perTok(r.input) +
    args.outputTokens        * perTok(r.output) +
    args.cacheCreationTokens * perTok(r.input * 1.25) +
    args.cacheReadTokens     * perTok(r.input * 0.10)
  return Math.round(cost * 1e5) / 1e5
}
