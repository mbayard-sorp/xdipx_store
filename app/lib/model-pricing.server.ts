// Rates are per 1M tokens, in USD, at SYNC (full) price.
// Batch source = 50% of these. Cache write = 1.25x input. Cache read = 0.10x input.
// Calls billed against the Max subscription (not the API key) cost 0. There is
// more than one label for that in the wild: see MAX_SUBSCRIPTION_SOURCES.

type Rate = { input: number; output: number }

const RATES: Record<string, Rate> = {
  'claude-sonnet-4-20250514':  { input: 3,   output: 15 },
  'claude-sonnet-4':           { input: 3,   output: 15 }, // undated alias
  'claude-sonnet-4-6':         { input: 3,   output: 15 }, // legacy alias used by ai-agent/chat
  'claude-haiku-4-5-20251001': { input: 1,   output: 5  },
  'claude-haiku-4-5':          { input: 1,   output: 5  }, // undated alias
  // Opus rates were missing entirely (ticket #96): any Opus-class row fell
  // through to a Sonnet-priced default and under-reported by ~5x, which
  // quietly loosened every daily $ cap computed from api_token_log.
  'claude-opus-4-20250514':    { input: 15,  output: 75 },
  'claude-opus-4-1-20250805':  { input: 15,  output: 75 },
  'claude-opus-4-1':           { input: 15,  output: 75 }, // undated alias
}

// Unknown model -> assume the premium (Opus) tier so estimates never lowball,
// matching the DEFAULT_VIDEO_RATE convention below. Overcounting an unknown
// model tightens a budget gate; undercounting silently loosens it (#96).
const DEFAULT_RATE: Rate = { input: 15, output: 75 }

/**
 * Source labels that mean "billed to a Max subscription, not the API key".
 *
 * `api.homepage-team.spend.tsx` accepted its `source` field through a bare
 * TypeScript `as` cast with no runtime validation, so callers wrote whatever
 * string they used internally and it was stored verbatim. Cloud routines use
 * these three; the repo's own SDK path uses 'agent-sdk'. They all mean the same
 * thing and must all cost zero, or a budget gate throttles a team on money that
 * was never spent.
 */
export const MAX_SUBSCRIPTION_SOURCES: ReadonlySet<string> = new Set([
  'agent-sdk',
  'anthropic-max',
  'max-subscription',
  'cloud-routine',
])

export function estimateCostUsd(args: {
  model: string
  source: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}): number {
  // Every one of these means "a human's Max subscription paid for this, the API
  // key did not". Only 'agent-sdk' was zero-rated before, so the others were
  // priced at full Opus list rates and charged against team budget gates as if
  // real money had moved. On 2026-08-21 a single 'anthropic-max' row booked
  // $43.50 of phantom cost and closed the social team's daily gate on it; the
  // team's actual spend that day was about four cents.
  if (MAX_SUBSCRIPTION_SOURCES.has(args.source)) return 0
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
  'fal/qwen-image-edit': 0.035, // Qwen-Image-Edit 2511 — stage-1 product plate
  'fal/flux-2-edit':     0.07,  // FLUX.2 [dev] edit — stage-2 scene composite.
                                // Billed per megapixel of input + output rather
                                // than per image; 0.07 covers a 9:16 1080x1920
                                // frame built from two references, rounded up so
                                // the per-video ceiling never lowballs.
  'imagen':             0.04,  // Google Vertex gemini-2.5-flash-image
  'imagen-3':           0.04,
  // Atlas Cloud (api.atlascloud.ai) — the primary still-image provider since
  // 2026-08-15. List prices from the model pages, verified at POC time.
  'atlas/seedream-4.5':           0.036, // ByteDance Seedream v4.5 text-to-image
  'atlas/seedream-4.5-edit':      0.036, // Seedream v4.5 edit — 1-10 reference images
  'atlas/seedream-5.0-lite':      0.032,
  'atlas/seedream-5.0-lite-edit': 0.032,
  'atlas/nano-banana-pro-edit':   0.14,  // Google filter blocks cast+toy pairings; premium alt only
  'atlas/flux-dev':               0.01,
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

// ---------------------------------------------------------------------------
// RunPod Serverless GPU pricing (Wan 2.2 14B, `wan22-i2v` / `wan22-t2v`).
// RunPod bills per GPU-SECOND actually consumed, not per second of finished
// video, so this is a different pricing model than the fal per-output-second
// rates above. Rather than one hardcoded number, this is TWO numbers:
//   - RUNPOD_GPU_USD_PER_SEC:      the rented GPU's $/GPU-second (env,
//     default 0.00031, measured against the live 1cnxz75c71177q endpoint
//     2026-08-22: RTX 4090 serverless flex at $1.10/hr, the class the
//     endpoint's workers actually land on since L40S stock is low).
//   - RUNPOD_RENDER_SECONDS_PER_CLIP_SECOND: an ASSUMED render-time
//     multiplier (45 GPU-seconds of render per second of finished clip,
//     from a measured fast-path run: 219669ms executionTime / 5.06s clip)
//     used ONLY for the pre-flight estimate, until per-job telemetry exists.
// estimateRunpodRatePerSecondUsd() multiplies these into a $/clip-second
// figure that slots into VIDEO_RATES exactly like a fal rate, so
// estimateVideoCostUsd/estimateJobCostUsd need no special-casing.
// computeRunpodActualCostUsd() is the REAL number: RunPod's /status response
// carries executionTime in milliseconds, actually GPU-seconds billed, and
// replaces the estimate once the job completes (video-pipeline clip stage).
// ---------------------------------------------------------------------------

const RUNPOD_GPU_USD_PER_SEC_DEFAULT = 0.00031
const RUNPOD_RENDER_SECONDS_PER_CLIP_SECOND = 45

function runpodGpuRatePerSecondUsd(): number {
  const raw = process.env['RUNPOD_GPU_USD_PER_SEC']
  const n = raw != null && raw.trim() !== '' ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : RUNPOD_GPU_USD_PER_SEC_DEFAULT
}

/** ESTIMATE-only $/clip-second for the wan22 tiers. See block comment above. */
export function estimateRunpodRatePerSecondUsd(): number {
  return runpodGpuRatePerSecondUsd() * RUNPOD_RENDER_SECONDS_PER_CLIP_SECOND
}

/**
 * ACTUAL USD cost of one completed RunPod job from its measured executionTime
 * (ms, from the /status response). This is the real number the estimate above
 * only approximates; the clip stage uses this to replace the estimate on the
 * job row and in api_token_log once a wan22 job completes. Never negative.
 */
export function computeRunpodActualCostUsd(executionMs: number): number {
  const seconds = Math.max(0, executionMs) / 1000
  const cost = runpodGpuRatePerSecondUsd() * seconds
  return Math.round(cost * 1e5) / 1e5
}

const VIDEO_RATES: Record<string, number> = {
  'fal/veo3.1':       0.40, // native audio, 1080p
  'fal/veo3.1-fast':  0.15, // native audio
  'fal/kling-2.5-pro': 0.07, // no native audio
  'fal/seedance-2.0': 0.31, // audio included, 720p
  'fal/grok-imagine-1.5': 0.14, // native audio, pinned to 720p (480p $0.08, 1080p $0.25)
  'fal/omnihuman-1.5': 0.16, // audio-driven avatar performance (image + audio -> talking video)
  'fal/sync-lipsync': 0.05, // lipsync billed ~$3/min of output video
  // RunPod Wan 2.2 14B (both i2v and t2v share one rented-GPU rate) — ESTIMATE
  // only, see estimateRunpodRatePerSecondUsd() above. Actual spend is metered
  // per job via computeRunpodActualCostUsd() and replaces this in api_token_log.
  'runpod/wan22':     estimateRunpodRatePerSecondUsd(),
  // Audio-driven talking mode on the same worker (ticket #5714). ESTIMATE
  // shares the wan22 $/clip-second derivation until the bake-off measures the
  // real render multiplier; actuals replace it per job via
  // computeRunpodActualCostUsd exactly like the i2v tier.
  'runpod/wan22-s2v': estimateRunpodRatePerSecondUsd(),
  'elevenlabs/tts':   0.003, // voiceover, ~$0.20/min of speech at Creator-plan credit rates
  'elevenlabs/music': 0.008, // music bed, ~$0.48/min — APPROXIMATE Creator-plan credit conversion
}

const DEFAULT_VIDEO_RATE = 0.40 // unknown model -> assume premium tier so estimates never lowball

/** Estimated USD for `seconds` of video from `model`. Never negative. */
export function estimateVideoCostUsd(model: string, seconds: number): number {
  const per = VIDEO_RATES[model] ?? DEFAULT_VIDEO_RATE
  const cost = per * Math.max(0, seconds)
  return Math.round(cost * 1e5) / 1e5
}
