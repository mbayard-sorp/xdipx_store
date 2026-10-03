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
 *
 * Ticket #13333 gave the product-fidelity sibling gate
 * (`gateProductFidelityBuffer`) the same remote-fallback treatment: see
 * `remoteFidelityCallVision`/`fidelityDepsForEnv` below.
 */

import type { VisionGateDeps, VisionVerdict } from './social-vision-gate.server'
import { runVisionGateOnImage } from './social-vision-gate.server'
import type { TeamId } from './team-keys'
import {
  runProductFidelityCheckOnImages,
  defaultFetchImageBase64,
  hasFidelityDrift,
  failClosedVerdict,
  type ProductFidelityDeps,
  type ProductFidelityVerdict,
} from './social-product-fidelity.server'

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
 *
 * `team` tells the route which team's budget/run-lock to gate on. Omit it to
 * keep the original content-team default (the Notebook hero path,
 * scripts/gen-notebook-art.ts, never passes one). The homepage path
 * (app/lib/homepage-media.server.ts) passes 'homepage' so a homepage
 * candidate is judged against the homepage team's own lock instead of
 * failing closed whenever an unrelated content-team run happens to be in
 * progress. The route used to hardcode gate('content', runId) for every
 * caller, so a homepage --run-id could never exclude the sibling run that
 * was actually blocking it, since that sibling was a content run with a
 * different id (run 1099, 2026-09-27: 4 slots attempted, 0 placed).
 */
export function remoteVisionCallVision(runId?: number, team?: TeamId): NonNullable<VisionGateDeps['callVision']> {
  const BASE_URL = (process.env['BASE_URL'] ?? 'https://xdipx.com').replace(/\/$/, '')
  const TEAM_TOKEN = process.env['TEAM_TOKEN'] ?? process.env['HOMEPAGE_TEAM_TOKEN'] ?? process.env['CRON_SECRET'] ?? ''
  return async (imageBase64, mediaType) => {
    if (!TEAM_TOKEN) throw new Error('vision-gate: no TEAM_TOKEN/HOMEPAGE_TEAM_TOKEN/CRON_SECRET in env for the remote route')
    const res = await fetch(`${BASE_URL}/api/team/vision-gate`, {
      method: 'POST',
      headers: { 'x-team-secret': TEAM_TOKEN, 'content-type': 'application/json' },
      // runId lets the route's gate(team, runId) exclude the caller's OWN
      // in-progress run (on its own team) from the run_in_progress
      // blocking-run check (mirrors the already-proven --run-id plumbing in
      // gen-social-image.ts). Without it, a run-scheduled generation always
      // sees itself as the blocking sibling run and the gate fails closed on
      // every call. `team` picks which team's lock/budget that check runs
      // against; the route defaults to 'content' when omitted.
      body: JSON.stringify({ imageBase64, mediaType, ...(runId !== undefined ? { runId } : {}), ...(team ? { team } : {}) }),
    })
    if (!res.ok) throw new Error(`vision-gate route HTTP ${res.status}`)
    const verdict = (await res.json()) as VisionVerdict
    if (!verdict.checkCompleted) {
      throw new Error(`vision-gate route could not complete the check: ${verdict.notes}`)
    }
    return {
      pass: verdict.pass,
      checks: verdict.checks,
      notes: verdict.notes,
      legibleText: verdict.legibleText,
      skinMarks: verdict.skinMarks,
      productPhysics: verdict.productPhysics,
      // Ticket #11029: isValidVerdictShape now requires both fields on every
      // parsed response; omitting them here would fail-close every remote
      // (sandbox-with-no-ANTHROPIC_API_KEY) call as a malformed shape.
      handDigitCounts: verdict.handDigitCounts,
      // Ticket #13174: forwarded so the caller's own enforceEnumeratedAnatomy
      // pass sees the same hidden-digit counts the route judged with.
      handOccludedDigits: verdict.handOccludedDigits ?? null,
      backAnatomyRead: verdict.backAnatomyRead,
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
export function visionDepsForEnv(runId?: number, team?: TeamId): VisionGateDeps | undefined {
  return process.env['ANTHROPIC_API_KEY']?.trim() ? undefined : { callVision: remoteVisionCallVision(runId, team) }
}

/**
 * Remote fallback for the product-fidelity gate's `callVision` hook (ticket
 * #13333), the sibling of `remoteVisionCallVision` above for
 * `social-product-fidelity.server.ts`'s own default `callVision`, which
 * builds `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` IN THIS
 * process the same way the anatomy gate's did. A cloud content run carries
 * no such key, so every fidelity check failed closed and
 * `scripts/gen-notebook-art.ts`'s unconditional upload-time check (ticket
 * #13119) refused the upload rather than ship an unchecked image, even when
 * the anatomy gate right above it had already completed cleanly via its own
 * remote fallback.
 *
 * By the time this hook runs, `gateProductFidelityBuffer` has already
 * fetched the reference image locally (a plain, unauthenticated GET — no
 * secret involved), so both images travel to the route as base64, mirroring
 * `remoteVisionCallVision`'s `imageBase64`/`mediaType` shape rather than
 * asking the route to re-fetch a url it would have to be given separately.
 * Throws on any transport/HTTP failure and when the server could not
 * complete the check (`checkCompleted: false`), exactly like
 * `remoteVisionCallVision`, so `runProductFidelityCheckOnImages` (this
 * function's caller, via `gateProductFidelityBuffer`) produces the same
 * fail-closed verdict a route outage or a local auth failure always has.
 */
export function remoteFidelityCallVision(runId?: number, team?: TeamId): NonNullable<ProductFidelityDeps['callVision']> {
  const BASE_URL = (process.env['BASE_URL'] ?? 'https://xdipx.com').replace(/\/$/, '')
  const TEAM_TOKEN = process.env['TEAM_TOKEN'] ?? process.env['HOMEPAGE_TEAM_TOKEN'] ?? process.env['CRON_SECRET'] ?? ''
  return async (renderedImage, referenceImage) => {
    if (!TEAM_TOKEN) throw new Error('vision-gate: no TEAM_TOKEN/HOMEPAGE_TEAM_TOKEN/CRON_SECRET in env for the remote route')
    const res = await fetch(`${BASE_URL}/api/team/vision-gate`, {
      method: 'POST',
      headers: { 'x-team-secret': TEAM_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'fidelity',
        imageBase64: renderedImage.data,
        mediaType: renderedImage.mediaType,
        referenceImageBase64: referenceImage.data,
        referenceMediaType: referenceImage.mediaType,
        ...(runId !== undefined ? { runId } : {}),
        ...(team ? { team } : {}),
      }),
    })
    if (!res.ok) throw new Error(`vision-gate route HTTP ${res.status}`)
    const verdict = (await res.json()) as ProductFidelityVerdict
    if (!verdict.checkCompleted) {
      throw new Error(`vision-gate route could not complete the fidelity check: ${verdict.notes}`)
    }
    // Return the raw rating shape, not the full verdict: the caller
    // (`runProductFidelityCheckOnImages`) re-validates via
    // `isValidFidelityShape` and stamps its own fresh `checkedAt` /
    // `checkCompleted: true`, the same contract `remoteVisionCallVision`
    // keeps with `getOneVerdict` above.
    return {
      silhouette: verdict.silhouette,
      colour: verdict.colour,
      finish: verdict.finish,
      brandMark: verdict.brandMark,
      notes: verdict.notes,
    }
  }
}

/**
 * Which `callVision` `gateProductFidelityBuffer`'s default should use: the
 * in-process Anthropic call when `ANTHROPIC_API_KEY` is present, the
 * privileged route when it is not. Exact sibling of `visionDepsForEnv`
 * above, for the product-fidelity gate instead of the anatomy gate.
 */
export function fidelityDepsForEnv(runId?: number, team?: TeamId): ProductFidelityDeps | undefined {
  return process.env['ANTHROPIC_API_KEY']?.trim() ? undefined : { callVision: remoteFidelityCallVision(runId, team) }
}

/** Base64-encode a candidate buffer and run it through the shared anatomy /
 *  imagery-ceiling vision gate. Never throws — same fail-closed contract as
 *  the social and Notebook-hero paths. `team` (default: the route's own
 *  'content' default) picks which team's budget/run-lock the remote check
 *  gates on when it has to fall back to the server-side route. */
export async function gateImageBuffer(buf: Buffer, deps?: VisionGateDeps, runId?: number, team?: TeamId): Promise<VisionVerdict> {
  return runVisionGateOnImage({ data: buf.toString('base64'), mediaType: sniffImageMediaType(buf) }, deps ?? visionDepsForEnv(runId, team))
}

/**
 * Sibling to `gateImageBuffer` for the hero cast-plus-product composite path
 * (ticket #13119, incidents run 1182 and run 1202): compares a rendered
 * candidate buffer against the real bare product reference image the
 * composite was actually given, the same silhouette/colour/finish/brandMark
 * comparison `social-product-fidelity.server.ts` already runs report-only
 * for on-skin social assets (ticket #11487), reused here as a buffer-based
 * check so a caller holding a not-yet-uploaded candidate can run it before
 * anything reaches disk or Sanity, exactly like the anatomy gate above.
 * Never throws: a reference-image fetch failure returns the same
 * `checkCompleted: false` fail-closed shape `runProductFidelityCheckOnImages`
 * itself already produces for a model-call failure, via the same
 * `failClosedVerdict` helper.
 *
 * `runId`/`team` (ticket #13333) are threaded straight through to
 * `fidelityDepsForEnv` when the caller passes no explicit `deps`, the same
 * env-aware-default treatment `gateImageBuffer` already gives the anatomy
 * gate above — a scheduled sandbox with no `ANTHROPIC_API_KEY` falls back to
 * the privileged route instead of failing every fidelity check closed.
 */
export async function gateProductFidelityBuffer(
  buf: Buffer,
  referenceImageUrl: string,
  deps?: ProductFidelityDeps,
  runId?: number,
  team?: TeamId,
): Promise<ProductFidelityVerdict> {
  const resolvedDeps = deps ?? fidelityDepsForEnv(runId, team)
  const fetchFn = resolvedDeps?.fetchImageBase64 ?? defaultFetchImageBase64
  let reference: { data: string; mediaType: string }
  try {
    reference = await fetchFn(referenceImageUrl)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return failClosedVerdict(`Product-fidelity reference image could not be fetched: ${message}`)
  }
  return runProductFidelityCheckOnImages(
    { data: buf.toString('base64'), mediaType: sniffImageMediaType(buf) },
    reference,
    resolvedDeps,
  )
}

/**
 * The blocking-gate predicate for a product-fidelity verdict: true only when
 * the check actually completed AND found no drift on any dimension.
 * Deliberately distinct from `hasFidelityDrift` alone, which reports `false`
 * (no drift) on an incomplete check — correct for `social-product-fidelity
 * .server.ts`'s existing report-only callers, where nothing was blocking on
 * the result anyway, but wrong for a gate that must fail closed on "could
 * not tell" the same way the anatomy gate's own `pass` already does.
 */
export function productFidelityPasses(verdict: ProductFidelityVerdict): boolean {
  return verdict.checkCompleted && !hasFidelityDrift(verdict)
}

/**
 * Ticket #12371. Two content runs (818, 1142) each drafted, dual-gated, and
 * only THEN discovered the hero anatomy gate's one Anthropic dependency could
 * not complete a check — once because `ANTHROPIC_API_KEY` was absent, once
 * because the account behind it had run out of credit. Different proximate
 * causes, same structural gap: the dependency is checked last, after the run
 * has spent its whole budget, so a routine learns it cannot publish at the
 * most expensive possible moment. This classifies a failed check's message
 * into a reason a caller can act on differently: a missing credential is an
 * env-var fix, an empty balance is a billing top-up, and neither is the
 * other. Matches on the underlying Anthropic error text regardless of how
 * many `Vision gate check could not complete: ...` / `vision-gate route
 * could not complete the check: ...` wrapper layers it passed through, since
 * both `getOneVerdict` (this module's own default `callVision`) and the
 * remote route (`remoteVisionCallVision`) nest the original message rather
 * than replacing it.
 */
export type VisionPreflightReason = 'no-credential' | 'no-credit' | 'unknown'

export function classifyVisionPreflightFailure(message: string): VisionPreflightReason {
  const m = message.toLowerCase()
  if (/credit balance|insufficient_quota|purchase credits|plans\s*(&|and)\s*billing/.test(m)) return 'no-credit'
  if (/authentication|api[\s_-]?key|unauthorized|x-api-key/.test(m)) return 'no-credential'
  return 'unknown'
}

export interface VisionPreflightResult {
  ok: boolean
  reason?: VisionPreflightReason
  message?: string
  /** Which dependency failed, when `ok` is false (ticket #13333): the
   *  anatomy gate and the product-fidelity gate are two independent
   *  Anthropic call paths with two independent remote-fallback routes, so a
   *  caller needs to know which one is actually broken. Omitted when `ok`. */
  dependency?: 'anatomy' | 'fidelity'
}

// Smallest possible valid PNG (1x1, transparent). The preflight only cares
// whether the check completes, never what it sees, so there is no reason to
// spend more than the cheapest possible payload on it.
const PREFLIGHT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

/**
 * A cheap, minimal vision-gate call whose only purpose is to prove the hero
 * path's Anthropic dependencies can actually complete a check, with the
 * failure reason classified. Meant to run right after a routine's own
 * budget/lock gate and before it spends a draft's worth of work on a post
 * that would end up heroless regardless — see the module doc comment above
 * for the two incidents this replaces a 40-minutes-late discovery for.
 *
 * Ticket #13333: extended to also prove the product-fidelity gate's own,
 * independent Anthropic dependency, not just the anatomy gate's. Run 1220
 * discovered that a content run's anatomy preflight passing clean said
 * nothing about whether the fidelity gate (a separate remote route call,
 * added later by ticket #13119) could complete at all — it died at upload
 * time instead, 40 minutes into the run, which is exactly the late-discovery
 * shape this preflight exists to prevent. Checks the anatomy dependency
 * first and returns immediately on failure, since a run with no working
 * anatomy gate cannot usefully reach the fidelity gate's reference-image
 * flow anyway and there is no reason to spend the second call.
 *
 * Never throws: neither `gateImageBuffer` nor `runProductFidelityCheckOnImages`
 * ever throws, and a `checkCompleted: false` verdict here is the expected
 * shape for "could not tell", not an exceptional path.
 */
export async function runVisionGatePreflight(runId?: number, team?: TeamId): Promise<VisionPreflightResult> {
  const verdict = await gateImageBuffer(Buffer.from(PREFLIGHT_PNG_BASE64, 'base64'), undefined, runId, team)
  if (!verdict.checkCompleted) {
    const message = verdict.notes ?? 'vision gate did not complete'
    return { ok: false, reason: classifyVisionPreflightFailure(message), message, dependency: 'anatomy' }
  }

  // Same cheapest-possible-payload reasoning as the anatomy check above: the
  // preflight only cares whether the fidelity check completes, never what it
  // finds, so the same 1x1 PNG stands in for both the "rendered" and
  // "reference" images rather than fetching or generating a real pair.
  const pngImage = { data: PREFLIGHT_PNG_BASE64, mediaType: 'image/png' as const }
  const fidelityVerdict = await runProductFidelityCheckOnImages(pngImage, pngImage, fidelityDepsForEnv(runId, team))
  if (!fidelityVerdict.checkCompleted) {
    const message = fidelityVerdict.notes ?? 'product-fidelity gate did not complete'
    return { ok: false, reason: classifyVisionPreflightFailure(message), message, dependency: 'fidelity' }
  }
  return { ok: true }
}
