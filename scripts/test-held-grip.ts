/**
 * scripts/test-held-grip.ts
 *
 * Ticket #11925, SPLIT 2 of 2 from #11476 (the acceptance test, as a reusable
 * harness). #11476 shipped `castMember.handReferencePhotoUrl` and the
 * `resolveCastReference`/`generate-cast-hand-references.ts` machinery that
 * attaches it to a held contact mode; nothing yet answers the actual
 * question that motivated it: does a hand reference produce a credible
 * self-held grip, and how often. This script is that acceptance test,
 * runnable again whenever the owner picks a new hand reference or the
 * generation prompt changes.
 *
 * Generates N (default 10) on-skin candidates of one product self-held in a
 * named cast member's hand, via POST /api/team/social-image { op: 'cast' }
 * (the same server-side route the daily social routine uses — generation and
 * rehost need SHOPIFY_ADMIN_ACCESS_TOKEN, which does not live in a scheduled
 * cloud sandbox, ticket #4133). Each attempt already runs through the vision
 * gate server-side (app/lib/social-media.server.ts's generateWithVisionGate);
 * this script reads back the persisted `productPhysics` report-only verdict
 * (ticket #11460) for every surviving candidate directly from
 * `social_media_assets.visionVerdict`, rather than re-judging the frame with
 * a second model call the production path already made.
 *
 * PRECONDITION, not a code path this script can create: the chosen cast
 * member's `handReferencePhotoUrl` must be set (owner-picked via
 * `scripts/generate-cast-hand-references.ts`, dedupeKey
 * `cast-hand-reference-casting-call-owner-pick`). This script REFUSES with a
 * clear message when it is not set, reusing `resolveCastReference`'s own
 * warning text, rather than silently falling back to the old body-plate-only
 * path and reporting a pass rate for a grip nobody actually tested.
 *
 * Spend is logged server-side by POST /api/team/social-image itself (ticket
 * #8032), exactly like every other `cast`-op caller (`scripts/gen-social-
 * image.ts`); nothing to log here.
 *
 * Needs `TEAM_TOKEN` (or `HOMEPAGE_TEAM_TOKEN`/`CRON_SECRET`), a Sanity read
 * token (`getApprovedCastMembers`), and `DATABASE_URL`. Not run from this
 * session — see the ticket's own DONE WHEN: a later session runs it and
 * files the pass rate as a social suggestion.
 *
 * Usage:
 *   npx tsx scripts/test-held-grip.ts --cast <slug> [--n 10]
 *     [--handle inbloom-rosales-sucking-vibrator]
 *     [--bare-ref https://cdn.shopify.com/s/files/1/0761/6872/4651/files/77544D.jpg]
 *     [--scale palm] [--out /tmp/held-grip-test] [--prompt "..."]
 */

import './_load-env'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { socialMediaAssets } from '../db/schema'
import { getApprovedCastMembers } from '../app/lib/sanity.server'
import { resolveCastReference } from '../app/lib/social-cast-reference.server'
import type { ProductPhysicsVerdict, VisionVerdict } from '../app/lib/social-vision-gate.server'
import type { GenerateCastCompositeResult } from '../app/lib/social-media.server'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const CAST_SLUG = arg('cast')
const N = Number(arg('n') ?? '10')
const HANDLE = arg('handle') ?? 'inbloom-rosales-sucking-vibrator'
const BARE_REF = arg('bare-ref') ?? 'https://cdn.shopify.com/s/files/1/0761/6872/4651/files/77544D.jpg'
const SCALE = arg('scale') ?? 'palm'
const OUT_DIR = arg('out') ?? '/tmp/held-grip-test'
const PROMPT = arg('prompt')
  ?? 'Close crop, product forward and filling the frame: the presenter\'s own hand grips the product '
    + 'firmly and naturally, fingers wrapped around it, palm bearing its weight, the product large and '
    + 'unmistakably the subject of the shot, per instagram-campaigns.md section 3.2c.'

const BASE_URL = (process.env['BASE_URL'] ?? 'https://xdipx.com').replace(/\/$/, '')
const TEAM_TOKEN = process.env['TEAM_TOKEN'] ?? process.env['HOMEPAGE_TEAM_TOKEN'] ?? process.env['CRON_SECRET'] ?? ''

export interface AttemptResult {
  attempt: number
  /** True when the candidate survived generateWithVisionGate's safety checks. */
  survived: boolean
  assetId: number | null
  url: string | null
  /** The persisted report-only verdict (ticket #11460); null when unread or the check never completed. */
  productPhysics: ProductPhysicsVerdict | null
  dropReason?: string
}

export interface HeldGripSummary {
  attempts: number
  survived: number
  supported: number
  unsupported: number
  notApplicable: number
  /** Survived but the productPhysics check itself never completed (no verdict to grade). */
  incomplete: number
  /** supported / attempts: the fraction of the whole run that produced a credible, gated grip. */
  passRate: number
}

/**
 * Pure report logic, unit-tested against fixture `AttemptResult` rows (mocked
 * gate results) with no network or database call.
 */
export function summarizeAttempts(results: AttemptResult[]): HeldGripSummary {
  const attempts = results.length
  const survived = results.filter((r) => r.survived).length
  const supported = results.filter((r) => r.productPhysics === 'supported').length
  const unsupported = results.filter((r) => r.productPhysics === 'unsupported').length
  const notApplicable = results.filter((r) => r.productPhysics === 'not_applicable').length
  const incomplete = results.filter((r) => r.survived && r.productPhysics == null).length
  return {
    attempts,
    survived,
    supported,
    unsupported,
    notApplicable,
    incomplete,
    passRate: attempts > 0 ? Number((supported / attempts).toFixed(4)) : 0,
  }
}

async function main() {
  if (!CAST_SLUG) {
    console.error('Usage: npx tsx scripts/test-held-grip.ts --cast <slug> [--n 10] [--handle ...] [--bare-ref ...] [--scale palm] [--out /tmp/held-grip-test]')
    process.exit(1)
  }
  if (!TEAM_TOKEN) {
    console.error('[test-held-grip] TEAM_TOKEN (or HOMEPAGE_TEAM_TOKEN / CRON_SECRET) is required to call POST /api/team/social-image')
    process.exit(1)
  }

  // Never read an empty roster as "there are none" (the same false-zero this
  // route's own caller guards against): an unauthenticated read of this
  // dataset has returned 1 of 8 before.
  const roster = await getApprovedCastMembers()
  if (!roster.length) {
    console.error('[test-held-grip] no approved cast members returned (check SANITY_API_TOKEN)')
    process.exit(1)
  }
  const member = roster.find((m) => m.slug === CAST_SLUG)
  if (!member) {
    console.error(`[test-held-grip] --cast "${CAST_SLUG}" is not an approved cast member. Approved: ${roster.map((m) => m.slug).join(', ')}`)
    process.exit(1)
  }

  // PRECONDITION (ticket #11925): refuse cleanly, reusing the production
  // route's own check and warning text, rather than silently falling back to
  // the old body-plate-only path and reporting a pass rate for a grip nobody
  // actually tested.
  const resolved = resolveCastReference({ member, cropScale: 'close', prompt: PROMPT, contactMode: 'self-held' })
  if (resolved.handReferenceMissing) {
    console.error(`[test-held-grip] REFUSING: ${resolved.warning}`)
    process.exit(1)
  }

  await mkdir(OUT_DIR, { recursive: true })

  const results: AttemptResult[] = []
  const date = new Date().toISOString().slice(0, 10)

  for (let attempt = 1; attempt <= N; attempt++) {
    console.error(`[test-held-grip] attempt ${attempt}/${N}...`)
    const res = await fetch(`${BASE_URL}/api/team/social-image`, {
      method: 'POST',
      headers: { 'x-team-secret': TEAM_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({
        op: 'cast',
        prompt: PROMPT,
        handle: HANDLE,
        mood: 'held-grip-test',
        date,
        castSlug: CAST_SLUG,
        productImageUrl: BARE_REF,
        scale: SCALE,
        cropScale: 'close',
        contactMode: 'self-held',
        count: 1,
        caller: 'test-held-grip',
      }),
    })

    if (res.status === 403) {
      const j = (await res.json().catch(() => ({}))) as { reason?: string }
      console.error(`[test-held-grip] gated (${j.reason ?? 'unknown'}); stopping early at attempt ${attempt}/${N}`)
      break
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[test-held-grip] HTTP ${res.status} on attempt ${attempt}: ${body.slice(0, 300)}`)
      results.push({ attempt, survived: false, assetId: null, url: null, productPhysics: null, dropReason: `http_${res.status}` })
      continue
    }

    const body = (await res.json()) as GenerateCastCompositeResult & { ok?: false; reason?: string }
    const url = body.urls[0] ?? null
    const assetId = body.assetIds?.[0] ?? null

    let productPhysics: ProductPhysicsVerdict | null = null
    if (assetId != null) {
      const rows = await db
        .select({ visionVerdict: socialMediaAssets.visionVerdict })
        .from(socialMediaAssets)
        .where(eq(socialMediaAssets.id, assetId))
        .limit(1)
      const verdict = rows[0]?.visionVerdict as VisionVerdict | null | undefined
      productPhysics = verdict?.productPhysics ?? null
    }

    if (url) {
      try {
        const imgRes = await fetch(url)
        const buf = Buffer.from(await imgRes.arrayBuffer())
        await writeFile(join(OUT_DIR, `attempt-${String(attempt).padStart(2, '0')}.jpg`), buf)
      } catch (err) {
        console.error(`[test-held-grip] failed to save frame for attempt ${attempt} (non-fatal)`, err)
      }
    }

    results.push({
      attempt,
      survived: url != null,
      assetId,
      url,
      productPhysics,
      ...(body.dropReasons?.[0] ? { dropReason: body.dropReasons[0] } : {}),
    })
    console.error(`[test-held-grip] attempt ${attempt}: ${url ? 'survived' : 'dropped'}, productPhysics=${productPhysics ?? 'n/a'}`)
  }

  const summary = summarizeAttempts(results)
  console.log(JSON.stringify({ member: member.slug, handle: HANDLE, outDir: OUT_DIR, ...summary, results }, null, 2))
}

// Guarded so `main` never runs as a side effect of importing `summarizeAttempts`
// from the test file.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[test-held-grip] fatal:', err)
      process.exit(1)
    })
}
