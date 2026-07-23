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

// ---------------------------------------------------------------------------
// Image generation pricing — USD per generated image, by provider/model key.
// Images are the main METERED cost of the autonomous homepage team (LLM
// reasoning runs on the Max subscription). Approximate list prices as of 2026;
// adjust here if a provider changes pricing. Keys match the `model` strings the
// fal/imagen wrappers pass to logImageCost().
// ---------------------------------------------------------------------------

const IMAGE_RATES: Record<string, number> = {
  'fal/flux-schnell':   0.003,
  'fal/flux-dev':       0.025,
  'fal/flux-pro':       0.05,
  'fal/flux-kontext':     0.04,  // FLUX.1 Kontext [pro] image-to-image
  'fal/flux-kontext-dev': 0.025, // FLUX.1 Kontext [dev] image-to-image (product refs; safety checker off)
  'fal/nano-banana':    0.039, // fal's Gemini-flash-image endpoint
  'imagen':             0.04,  // Google Vertex gemini-2.5-flash-image
  'imagen-3':           0.04,
}

const DEFAULT_IMAGE_RATE = 0.04 // unknown model -> assume a flash-image-tier price

/** Estimated USD for `count` images from `model`. Never negative. */
export function estimateImageCostUsd(model: string, count: number): number {
  const per = IMAGE_RATES[model] ?? DEFAULT_IMAGE_RATE
  const cost = per * Math.max(0, count)
  return Math.round(cost * 1e5) / 1e5
}

// ---------------------------------------------------------------------------
// Video generation pricing — USD per SECOND of generated video, by cost key.
// Video is the store's most expensive media type; these rates back the per-video
// cost estimate shown in admin before generation, the hard per-video ceiling
// valve, and the video team's daily budget gate. Approximate list prices as of
// 2026-07; adjust here when fal reprices. Keys match VIDEO_MODELS[*].costKey in
// fal-video.server.ts.
// ---------------------------------------------------------------------------

const VIDEO_RATES: Record<string, number> = {
  'fal/veo3.1':       0.40, // native audio, 1080p
  'fal/veo3.1-fast':  0.15, // native audio
  'fal/kling-2.5-pro': 0.07, // no native audio
  'fal/seedance-2.0': 0.31, // audio included, 720p
  'fal/sync-lipsync': 0.05, // lipsync billed ~$3/min of output video
  'elevenlabs/tts':   0.003, // voiceover, ~$0.20/min of speech at Creator-plan credit rates
}

const DEFAULT_VIDEO_RATE = 0.40 // unknown model -> assume premium tier so estimates never lowball

/** Estimated USD for `seconds` of video from `model`. Never negative. */
export function estimateVideoCostUsd(model: string, seconds: number): number {
  const per = VIDEO_RATES[model] ?? DEFAULT_VIDEO_RATE
  const cost = per * Math.max(0, seconds)
  return Math.round(cost * 1e5) / 1e5
}
