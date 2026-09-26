/**
 * Buffer-based anatomy / imagery-ceiling vision gate for a local generation
 * candidate that has not been uploaded anywhere yet, so there is no live url
 * for `runVisionGate` (app/lib/social-vision-gate.server.ts) to fetch.
 *
 * Extracted from scripts/gen-notebook-art.ts (ticket #10483) so a server
 * module can gate its own image path too, without importing from `scripts/`
 * — a server file under `app/lib` runs inside the Vercel function bundle and
 * must not depend on a CLI-only script, which runs in a separate `tsx`
 * process. `scripts/gen-notebook-art.ts` keeps its original four export
 * names (`sniffImageMediaType`, `remoteVisionCallVision`, `heroVisionDeps`,
 * `gateHeroBuffer`) as thin re-exports of this module, since its own test
 * (`scripts/gen-notebook-art.test.ts`) imports them by those names.
 */

import type { VisionGateDeps, VisionVerdict } from './social-vision-gate.server'
import { runVisionGateOnImage } from './social-vision-gate.server'

/**
 * Sniff the real container format from a candidate buffer's magic bytes.
 * `generateImage()`'s `GenerateImageResult` carries no content-type alongside
 * its raw `Buffer[]` (providers are mixed: Atlas's ref-image/edit path
 * commonly returns JPEG, fal/Imagen commonly return PNG), and a hardcoded
 * `image/png` declaration mismatches the real bytes on an Atlas-sourced
 * candidate. Anthropic's vision endpoint validates the declared media type
 * against the bytes and 400s on a mismatch, which would fail the gate closed
 * with `checkCompleted: false` — never a real anatomy read. Same
 * allowlist/fallback as the social path's own detection
 * (`social-vision-gate.server.ts`'s `fetchImageBase64` default).
 */
export function sniffImageMediaType(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return 'image/jpeg' // matches the social path's own unknown-format fallback
}

/**
 * Remote fallback for the anatomy vision gate's `callVision` hook (ticket
 * #8989). `social-vision-gate.server.ts`'s default `callVision` builds
 * `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` IN THIS
 * process, which a scheduled CLI sandbox does not always carry (blocker
 * #142, the Notebook hero path). The fix already proven for social images
 * (ticket #4133): POST to a route that runs the privileged call SERVER-SIDE,
 * where the key already lives, instead of needing the key here. Throws on
 * any transport/HTTP failure, and also when the server itself could not
 * complete the check (its own `checkCompleted: false`) — either way
 * `runVisionGateOnImage` (this function's caller, via `gateImageBuffer`)
 * treats the throw exactly like a local auth/transport failure and produces
 * the same fail-closed verdict, so a route outage degrades the same way a
 * missing key always has, never as a silent pass.
 */
export function remoteVisionCallVision(runId?: number): NonNullable<VisionGateDeps['callVision']> {
  const BASE_URL = (process.env['BASE_URL'] ?? 'https://xdipx.com').replace(/\/$/, '')
  const TEAM_TOKEN = process.env['TEAM_TOKEN'] ?? process.env['HOMEPAGE_TEAM_TOKEN'] ?? process.env['CRON_SECRET'] ?? ''
  return async (imageBase64, mediaType) => {
    if (!TEAM_TOKEN) throw new Error('vision-gate: no TEAM_TOKEN/HOMEPAGE_TEAM_TOKEN/CRON_SECRET in env for the remote route')
    const res = await fetch(`${BASE_URL}/api/team/vision-gate`, {
      method: 'POST',
      headers: { 'x-team-secret': TEAM_TOKEN, 'content-type': 'application/json' },
      // runId lets the route's gate('content', runId) exclude the caller's OWN
      // in-progress content run from the run_in_progress blocking-run check
      // (mirrors the already-proven --run-id plumbing in gen-social-image.ts).
      // Without it, a content-run-scheduled hero generation always sees itself
      // as the blocking sibling run and the gate fails closed on every call.
      body: JSON.stringify({ imageBase64, mediaType, ...(runId !== undefined ? { runId } : {}) }),
    })
    if (!res.ok) throw new Error(`vision-gate route HTTP ${res.status}`)
    const verdict = (await res.json()) as VisionVerdict
    if (!verdict.checkCompleted) {
      throw new Error(`vision-gate route could not complete the check: ${verdict.notes}`)
    }
    return {
      pass: verdict.pass, checks: verdict.checks, notes: verdict.notes,
      legibleText: verdict.legibleText, skinMarks: verdict.skinMarks,
    }
  }
}

/**
 * Which `callVision` `gateImageBuffer`'s default should use: the in-process
 * Anthropic call when `ANTHROPIC_API_KEY` is present (owner/local/preview
 * runs, unchanged), the privileged route when it is not (a scheduled
 * sandbox, ticket #8989). Only consulted when a caller passes no explicit
 * `deps` — every test that exercises this passes its own `callVision` and is
 * unaffected by which branch this returns.
 */
export function visionDepsForEnv(runId?: number): VisionGateDeps | undefined {
  return process.env['ANTHROPIC_API_KEY']?.trim() ? undefined : { callVision: remoteVisionCallVision(runId) }
}

/** Base64-encode a candidate buffer and run it through the shared anatomy /
 *  imagery-ceiling vision gate. Never throws — same fail-closed contract as
 *  the social and Notebook-hero paths. */
export async function gateImageBuffer(buf: Buffer, deps?: VisionGateDeps, runId?: number): Promise<VisionVerdict> {
  return runVisionGateOnImage({ data: buf.toString('base64'), mediaType: sniffImageMediaType(buf) }, deps ?? visionDepsForEnv(runId))
}
