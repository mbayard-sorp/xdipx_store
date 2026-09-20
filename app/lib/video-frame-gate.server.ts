/**
 * Post-render vision gate for the video pipeline (ticket #10485).
 *
 * Incident this closes: the pre-existing frame gate
 * (`video-pipeline.server.ts`'s `frameReviewEnabled`) only ever inspected the
 * SEED STILL, before any motion existed. `runVisionGate`
 * (app/lib/social-vision-gate.server.ts) had exactly two call sites, both
 * stills — zero anywhere in the video pipeline. Once a composition is
 * licensed to sit AT the doctrine's on-skin ceiling
 * (docs/store-team/instagram-campaigns.md 3.2c, owner ruling 2026-09-20), a
 * clip that starts at the ceiling has nowhere to drift but through it, and
 * nothing between the clip stage and 'done' ever looked at the rendered
 * video.
 *
 * This module runs two checks against a sampled set of rendered frames
 * (`video-assembly.server.ts`'s `extractFrames`, plus the poster):
 *
 *  1. The existing per-frame anatomy/imagery-ceiling gate
 *     (`runVisionGateOnImage`, app/lib/social-vision-gate.server.ts), reused
 *     rather than forked — the same core every other buffer-based gate in
 *     the codebase calls (the Notebook hero path, `scripts/gen-notebook-art.ts`,
 *     is the other caller holding a local, not-yet-uploaded candidate buffer
 *     rather than a live url). Every frame here comes from ffmpeg's own JPEG
 *     extraction (`extractPoster`/`extractFrames`'s `-q:v` mjpeg output), so
 *     the media type is always `image/jpeg` by construction — no format
 *     sniffing needed, unlike a mixed-provider (Atlas/fal/Imagen) buffer.
 *  2. A NEW pairwise check across consecutive samples for PRODUCT MOVEMENT
 *     relative to the body. 3.2c's binding rule is that a licensed product
 *     RESTS and never presses or pushes; motion along skin is not a pose, it
 *     is an act, and 3.2a stops a depicted or discernible sex act. No
 *     single-frame check can ever catch this: each individual frame can pass
 *     the anatomy/ceiling gate while the position drifts between them.
 *
 * A FAIL parks the job for owner review rather than failing it outright — a
 * false positive on a licensed on-skin frame must not burn a $2-3 render.
 */

import type { VisionGateDeps, VisionVerdict } from './social-vision-gate.server'
import { runVisionGateOnImage } from './social-vision-gate.server'
import { SONNET } from './models.server'
import type { ExtractedFrame } from './video-assembly.server'

// ─── Pairwise product-movement check ────────────────────────────────────────

export interface FramePairVerdict {
  pass: boolean
  notes: string
  /** False means the check itself never ran to completion (auth/transport/
   *  malformed response) — same distinction VisionVerdict.checkCompleted
   *  draws, so a caller never bills or trusts a check that never happened. */
  checkCompleted: boolean
}

export interface FrameMovementDeps {
  /** `data` is base64. Frames are always JPEG (ffmpeg's own extraction format — see the file header). */
  compareFrames?: (a: { data: string }, b: { data: string }) => Promise<unknown>
}

/**
 * Exported so the wording is directly testable as text, matching the pattern
 * `VISION_SYSTEM_PROMPT` (social-vision-gate.server.ts) already sets for its
 * own calibration risk: a check with two failure directions (missing real
 * movement, or over-firing on ordinary camera shake / re-grip) where only the
 * wording decides which one a well-meaning edit produces.
 */
export const FRAME_MOVEMENT_SYSTEM_PROMPT = `You are a strict content-safety QA reviewer for AI-generated marketing video on a mainstream sexual-wellness storefront. You will be shown two frames from the SAME shot, frame A earlier and frame B later. A product is licensed to rest against or along the body at an exposure ceiling; the binding rule is that it RESTS and never presses, pushes, thrusts, or is inserted or withdrawn. Judge ONLY whether the product's position relative to the body changed between the two frames in a way that reads as that kind of motion (sliding, pressing, entering, or withdrawing), not whether the frames differ at all — ordinary camera shake, hand re-grip, or breathing motion with the product's position otherwise unchanged is NOT a failure. If there is no product touching the body in either frame, or the product's position relative to the body is unchanged, pass. Fail only when the product's position relative to the body has moved in a way consistent with pressing, sliding, entering, or withdrawing. If you are uncertain whether a difference between the frames is the product moving against the body or just camera motion, pass — this check exists to catch unambiguous drift, not to flag every pixel difference between two video frames of the same shot.

Respond with ONLY a JSON object, no prose before or after, in exactly this shape:
{"productMoved": true|false, "notes": "one or two sentences on what you saw, especially for any true"}`

/** A verdict that fails, used only when the check could not run at all. */
function failClosedMovement(notes: string): FramePairVerdict {
  return { pass: false, notes, checkCompleted: false }
}

export function isValidMovementShape(v: unknown): v is { productMoved: boolean; notes: string } {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o['productMoved'] === 'boolean' && typeof o['notes'] === 'string'
}

const defaultCompareFrames: NonNullable<FrameMovementDeps['compareFrames']> = async (a, b) => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })
  const msg = await client.messages.create({
    model: SONNET,
    max_tokens: 300,
    system: FRAME_MOVEMENT_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: a.data } },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.data } },
          { type: 'text', text: 'Frame A is earlier, frame B is later. Return the JSON verdict now.' },
        ],
      },
    ],
  })
  const block = msg.content[0]
  if (block?.type !== 'text') throw new Error('frame-movement check: unexpected response block type')
  const cleaned = block.text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  return JSON.parse(cleaned)
}

/** Compare one consecutive frame pair for product movement relative to the body. Never throws — fails closed. */
export async function compareFramePairForProductMovement(
  a: Buffer,
  b: Buffer,
  deps?: FrameMovementDeps,
): Promise<FramePairVerdict> {
  const compare = deps?.compareFrames ?? defaultCompareFrames
  try {
    const imgA = { data: a.toString('base64') }
    const imgB = { data: b.toString('base64') }
    const parsed = await compare(imgA, imgB)
    if (!isValidMovementShape(parsed)) {
      return failClosedMovement('Frame-movement check response did not match the expected verdict shape; failing closed.')
    }
    return { pass: !parsed.productMoved, notes: parsed.notes, checkCompleted: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return failClosedMovement(`Frame-movement check could not complete: ${message}`)
  }
}

/**
 * Run the pairwise check across every CONSECUTIVE pair in a sampled sequence,
 * short-circuiting at the first failing or incomplete pair. Fewer than two
 * frames means nothing to compare, which passes trivially (matches the
 * per-frame gate's own "no visible people/hands" trivial-pass convention).
 */
export async function checkFrameSequenceForProductMovement(
  frames: Buffer[],
  deps?: FrameMovementDeps,
): Promise<FramePairVerdict> {
  if (frames.length < 2) {
    return { pass: true, notes: 'fewer than two frames sampled; nothing to compare', checkCompleted: true }
  }
  for (let i = 1; i < frames.length; i++) {
    const verdict = await compareFramePairForProductMovement(frames[i - 1]!, frames[i]!, deps)
    if (!verdict.pass) return verdict
  }
  return { pass: true, notes: 'no product movement detected across sampled frames', checkCompleted: true }
}

// ─── Aggregate gate over a sampled frame set ────────────────────────────────

export interface VideoFrameGateResult {
  pass: boolean
  /** Human-readable summary; names the failing timestamp or pair when pass is false. */
  notes: string
  frameVerdicts: VisionVerdict[]
  movementVerdict: FramePairVerdict
}

export interface VideoFrameGateDeps {
  visionDeps?: VisionGateDeps
  movementDeps?: FrameMovementDeps
}

/**
 * Gate a sampled sequence of rendered-clip frames (in chronological order):
 * every frame individually against the anatomy/imagery-ceiling gate, then
 * the whole sequence for product movement. Stops at the first per-frame
 * failure without running the movement check (nothing to gain from comparing
 * a sequence that already failed on its own pixels).
 */
export async function gateVideoFrames(
  frames: ExtractedFrame[],
  deps?: VideoFrameGateDeps,
): Promise<VideoFrameGateResult> {
  const frameVerdicts: VisionVerdict[] = []
  for (const f of frames) {
    const verdict = await runVisionGateOnImage({ data: f.buffer.toString('base64'), mediaType: 'image/jpeg' }, deps?.visionDeps)
    frameVerdicts.push(verdict)
    if (!verdict.pass) {
      return {
        pass: false,
        notes: `frame at ${f.atSeconds.toFixed(1)}s failed the anatomy/imagery-ceiling check: ${verdict.notes}`,
        frameVerdicts,
        movementVerdict: { pass: true, notes: 'not run: an earlier per-frame check already failed', checkCompleted: true },
      }
    }
  }

  const movementVerdict = await checkFrameSequenceForProductMovement(frames.map(f => f.buffer), deps?.movementDeps)
  if (!movementVerdict.pass) {
    return {
      pass: false,
      notes: `product-movement check failed: ${movementVerdict.notes}`,
      frameVerdicts,
      movementVerdict,
    }
  }

  return { pass: true, notes: 'every sampled frame passed', frameVerdicts, movementVerdict }
}
