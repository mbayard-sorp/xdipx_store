/**
 * Rolling-window mix report for posted Instagram frames (ticket #10271).
 *
 * NOT A GATE. This module produces a report, never a per-frame verdict, and
 * it must never be wired into social-publish-gate.server.ts or any BLOCK/
 * REVISE/HOLD path. The ticket that created it forbids that route explicitly:
 * the publish gate already owns per-frame judgment, and this report's whole
 * job is the thing the gate structurally cannot do -- notice that the last
 * ten frames were all quiet, which costs the gate nothing to approve one at a
 * time but costs the feed everything in aggregate.
 *
 * Root cause this exists to fix (ticket #10271, owner direction 2026-09-19):
 * the last 21 posted Instagram frames held 12 product-free, 7 hands-and-
 * strand lube macros and 1 self-described ceiling frame, against the ~12 the
 * 4-per-rolling-7 target in `docs/store-team/instagram-campaigns.md` §3.2b
 * implies. Nobody saw it for three weeks because seeing it required an
 * ad-hoc SQL query. `computeSocialMixReport` is that query, always on, with
 * one pure function so it is unit-testable without a database (ticket
 * #10110 half-detected the same regression the day before and sat at
 * `approved`, unapplied, specifically because nothing read it).
 *
 * Column dependencies (data-contract note, `docs/audits/
 * conversation-channels-product-lookup-audit-2026-08-04.md`): `bodyZone`,
 * `contactMode` and `cropScale` land in PR #1227 / migration 099 (ticket
 * #10269), which was still open (unmerged) when this file was written. This
 * module is coded against those column names ahead of the merge, per the
 * ticket's own instruction; until #1227 lands, every row read from the
 * database has `bodyZone`/`cropScale` = null, so the body-zone window and
 * close-crop lines read UNKNOWN in production (never a guessed 0) until
 * rows start carrying real values. `sceneLocation` (migration 093) is
 * already live on `main`, but per ticket #10269's own finding it has never
 * been sent by any caller, so it too reads UNKNOWN today. No line here ever
 * derives a verdict from caption/imageBrief prose -- an unpopulated column
 * prints UNKNOWN, it is never inferred.
 *
 * There is currently no `lube_treatment`-shaped column anywhere in
 * `social_posts` (searched `db/schema.ts` and every migration under
 * `db/migrations/`), so the lube-treatment-repeat line is unconditionally
 * UNKNOWN. It is printed anyway, on its own line, so its absence stays
 * visible instead of quietly dropped -- the failure mode this whole ticket
 * exists to close.
 *
 * WHAT TICKET #10478 CHANGED, and why each one made the report read green
 * while the campaign ran blind:
 *
 *  1. UNKNOWN now alarms. `anyBreach` tests `status !== 'ok'`, so the
 *     most-decayed signal in the system can no longer sit silent behind an
 *     "in band" headline. `worstStatus` names which it is, so the admin page
 *     can paint UNKNOWN as UNKNOWN rather than as a breach or as fine print.
 *     A new coverage line counts how many of the last 7 carry all four axes.
 *     A report that gates nothing costs nothing to make loud.
 *  2. Video rows no longer dilute the stills windows. Nothing on the video
 *     path writes bodyZone/contactMode/cropScale, so a week of reels used to
 *     shrink every on-skin count while the rolling-7 still held 7 rows, and
 *     "0 close crops" read green. Video rows are excluded from the still
 *     windows and printed as their own line instead.
 *  3. X is in. Instagram and X share one imagery fence until X can label
 *     sensitive media, and X is the surface that cannot label, so the report
 *     computes per platform for both. The caps are per feed, so the windows
 *     are per feed.
 *  4. The `none` sentinel. The art director is instructed to emit
 *     `bodyZone: 'none'` for a frame with no bare skin. Treating any non-null
 *     zone as an on-skin frame turned two consecutive non-skin posts into a
 *     false zone repeat and a false BREACH. `none` now reads as "known, not
 *     on-skin": it counts toward coverage and toward nothing else.
 *  5. The outcome variable. Report-only measurement of inputs is only
 *     meaningful next to the result it predicts, so platform-attributed
 *     removals in the last 30 days print per platform.
 *
 * STILL NOT A GATE. Owner ruling 2026-09-20 (blocker #194) made the §3.2c
 * caps report-only, and that is exactly why the lines above are strict: none
 * of this can refuse a post, so none of it needs to be forgiving.
 */

import { NON_SKIN_SENTINEL, hasAllSceneAxes } from './social-scene-vocab'

/** The two surfaces that share one imagery fence (instagram-campaigns.md §3.2c). */
export const MIX_REPORT_PLATFORMS = ['instagram', 'x'] as const
export type MixReportPlatform = (typeof MIX_REPORT_PLATFORMS)[number]

export interface SocialMixReportRow {
  id: number
  /**
   * Which feed this row posted to. Instagram and X are computed separately:
   * the §3.2b/§3.2c caps are per feed, and an aggregate across both would
   * average one quiet surface into another loud one.
   */
  platform: MixReportPlatform
  /**
   * `media_kind` (migration 086): 'image' | 'video' | 'none', nullable on
   * pre-086 rows. A video row is excluded from every stills window below,
   * because nothing on the video path writes the axes and leaving reels in
   * the denominator is what made a week of them read green.
   */
  mediaKind: string | null
  /** True when the row is product-forward: `shopify_product_id` is set. */
  shopifyProductId: string | null
  /** `media_urls`; a carousel is >1 URL (matches `social-post-ops.server.ts`'s `mediaForRow`). */
  mediaUrls: string[] | null
  /** migration 099 (PR #1227, ticket #10269). Null on every row until that PR merges and ships callers. */
  bodyZone: string | null
  /** migration 099 (PR #1227, ticket #10269). Drives the contact-mode repeat window (#10340). */
  contactMode: string | null
  /** migration 099 (PR #1227, ticket #10269). Null on every row until that PR merges and ships callers. */
  cropScale: string | null
  /** migration 093, live on main, but unsent by every caller per ticket #10269's finding. */
  sceneLocation: string | null
  /**
   * migration 093 (`cast_slugs`, jsonb). Null means the column was never sent
   * for this row (UNKNOWN); an empty array means a known cast-free frame.
   */
  castSlugs: string[] | null
}

export type LineStatus = 'ok' | 'breach' | 'unknown'

export interface MixReportLine {
  label: string
  /** Formatted "actual vs target" text, e.g. "1 / 7 (target 4, band 3-5)". */
  detail: string
  status: LineStatus
}

export interface SocialMixReport {
  /** How many rows the report actually had to work with (<= what was requested). */
  sampleSize: number
  /** Which feed these numbers describe. */
  platform: MixReportPlatform
  lines: {
    coverage: MixReportLine
    videoRows: MixReportLine
    removals: MixReportLine
    ceiling: MixReportLine
    mid: MixReportLine
    educational: MixReportLine
    closeCrop: MixReportLine
    productForward: MixReportLine
    productFree: MixReportLine
    bodyZoneWindow: MixReportLine
    contactModeWindow: MixReportLine
    locationWindow: MixReportLine
    castRotation: MixReportLine
    castVolume: MixReportLine
    wideCeiling: MixReportLine
    plug: MixReportLine
    lubeTreatment: MixReportLine
    carousel: MixReportLine
  }
  /**
   * True if ANY line is not `ok`, UNKNOWN included (#10478). The old version
   * tested `status === 'breach'` only, so an unpopulated column never
   * alarmed and the report read clean by construction. The name is kept
   * because callers read it; `worstStatus` is what distinguishes the two.
   */
  anyBreach: boolean
  /** 'breach' beats 'unknown' beats 'ok'. What a headline should actually say. */
  worstStatus: LineStatus
}

/** Both feeds, plus a single headline across them. */
export interface SocialMixReportBundle {
  instagram: SocialMixReport
  x: SocialMixReport
  /** True when either feed has a non-ok line. */
  anyBreach: boolean
  worstStatus: LineStatus
}

/** Numbers that come from a second query rather than from the window rows. */
export interface SocialMixReportExtras {
  /**
   * Platform-attributed removals in the last 30 days (status='deleted',
   * `removal_source != 'owner'`). null = could not be read, which prints
   * UNKNOWN rather than a reassuring 0.
   */
  removals30d?: number | null
}

// docs/store-team/instagram-campaigns.md §3.2b: "roughly 4 at the ceiling, 2
// mid, 1 educational" per rolling 7. "Roughly" per the doc's own wording, so
// a line reads BREACH outside a +/-1 band, not on every non-exact count.
const CHARGE_WINDOW = 7
const CHARGE_TARGETS = { ceiling: 4, mid: 2, educational: 1 } as const
const CHARGE_TOLERANCE = 1

// #10272 item 6 (on-skin campaign, owner all-hands 2026-09-19): the two
// on-skin body-zone bands that map to a charge tier. Zones outside both
// lists (top-of-thigh, ankle) are real on-skin frames but the doc does not
// assign them a tier, so they count toward neither -- an honest gap, not a
// guess.
// #10340 item 3: the plug-between-the-cheeks placement §3.2c licenses
// explicitly is ceiling tier ("the highest-classifier-signal frame in the
// campaign"), so it belongs in this list as well as in its own capped line.
export const CEILING_ZONES = new Set(['hip-hollow', 'small-of-back', 'sternum', 'stomach', 'gluteal-cleft'])
// #10340 item 5: 'nape' is retired by §3.2c ("The nape is retired until a SKU
// fits it" -- we sell no neck massager), so it no longer scores as a mid frame.
export const MID_ZONES = new Set(['inner-wrist', 'forearm', 'behind-knee', 'shoulder-blade'])

// §3.2c, owner direction 2026-09-19: the plug laid between the cheeks is
// licensed at "at most one per rolling 7" and is "the first frame to drop if
// the removal watcher fires", so it gets its own counted line rather than
// hiding inside the ceiling band.
export const PLUG_ZONE = 'gluteal-cleft'
const PLUG_CAP = 1

// §3.2c, same paragraph as the close-crop cap: "at least one ceiling frame per
// rolling 7 wide enough to read a location". Wide enough = not a close crop:
// the same complement this file already uses for CLOSE_CROP_SCALES below
// ("'medium'/'wide' are not close crops"), and the same pairing
// video-pipeline.server.ts uses ("drop the shot to cropScale medium or
// wide"). Originally read `new Set(['medium'])` only, which zeroed the floor
// against every real ceiling-tier asset in the library: the art director
// tags true location-establishing ceiling frames 'wide' (the widest token in
// CROP_SCALES), not 'medium', so wideCeiling had reported 0/7 for weeks
// while assets 605/606/608/612/626-629 sat unused and the floor was
// structurally unsatisfiable (ticket #11452).
const WIDE_CEILING_MIN = 1
const WIDE_CEILING_SCALES = new Set(['medium', 'wide'])

// §3.2b Cast: "at most 4 cast frames per rolling 14" and "no single cast member
// appears in more than 2 of any 5 consecutive cast frames".
const CAST_VOLUME_WINDOW = 14
const CAST_VOLUME_CAP = 4
const CAST_ROTATION_WINDOW = 5
const CAST_ROTATION_CAP = 2

// #10267/#10272 item 4 (the cap predates the wardrobe amendment and both
// versions state it identically): at most 3 close crops per rolling 7 (the
// same CHARGE_WINDOW above), never two consecutive. "Close crop" = the two
// tight crop_scale values; 'medium'/'wide' are not close crops.
const CLOSE_CROP_CAP = 3
export const CLOSE_CROP_SCALES = new Set(['macro', 'close'])

// mission-brief.md §6b + ticket #10110's own reading of it ("misses the ~40%
// product-in-scene share... clears the <=50% ceiling"): read as a rolling-14
// band, per ticket #10271's own window choice for this line. Below the floor
// is exactly the failure #10110 detected and #10271 exists to keep visible;
// above the ceiling is the inverse failure (all-product spam).
const PRODUCT_WINDOW = 14
const PRODUCT_FORWARD_FLOOR_SHARE = 0.4
const PRODUCT_FORWARD_CEILING_SHARE = 0.5
// #10110: "misses the standing two-week floor of 'at least one product-free
// resource post'." A hard floor independent of the share band above.
const PRODUCT_FREE_MIN = 1

// #10267/#10272 item 3/6: no body-zone repeat inside 5 consecutive on-skin
// frames; no location repeat inside 8 consecutive product posts (§3.8,
// unchanged by the on-skin campaign).
const BODY_ZONE_WINDOW = 5
const LOCATION_WINDOW = 8
// #10340 item 4: contact mode is the second of §3.2c's three variety axes and
// it rotates the same way the body zone does, so it gets the same window of 5.
// It was read from the database and then used by nothing, which is the silent
// half-measurement this ticket exists to close.
const CONTACT_MODE_WINDOW = 5

// #10110: "misses the standing two-week floor of... at least one carousel
// published." Same rolling-14 window as PRODUCT_WINDOW above.
const CAROUSEL_MIN = 1

function isCarousel(row: SocialMixReportRow): boolean {
  return (row.mediaUrls?.length ?? 0) > 1
}

function isProductForward(row: SocialMixReportRow): boolean {
  return !!row.shopifyProductId
}

/**
 * A row is on-skin when its zone is KNOWN and is not the `none` sentinel
 * (#10478 defect 4). The art director emits `bodyZone: 'none'` for a frame
 * that touches no bare skin, so treating any non-null zone as on-skin made
 * two consecutive non-skin posts read as a zone repeat and a false BREACH.
 */
function isOnSkin(row: SocialMixReportRow): boolean {
  return row.bodyZone != null && row.bodyZone !== NON_SKIN_SENTINEL
}

/** Known means "the writer answered", which `none` is. Drives coverage, not tiers. */
function zoneIsKnown(row: SocialMixReportRow): boolean {
  return row.bodyZone != null
}

/**
 * Video rows carry no scene axes (the fan-out insert writes castSlugs and
 * shopifyProductId only), so they are excluded from every stills window.
 *
 * DATA CONTRACT (production, 2026-09-20): `media_kind` is NULL on 271 of 281
 * `social_posts` rows and there is not one row with `media_kind = 'video'`.
 * Two consequences, both load-bearing:
 *
 *  1. The exclusion is computed HERE, in TypeScript, never as a SQL
 *     `media_kind != 'video'`. That predicate evaluates to NULL for a NULL
 *     row, which is not TRUE, so it would silently drop 271 of 281 rows and
 *     empty every rolling window. The live query filters platform/status
 *     only. This is the enrichment-filter rule from the 2026-08-04
 *     conversation-channels audit applied to a nullable column.
 *  2. NULL means "still, kind not recorded", not "unknown, alarm". It is the
 *     historical default of every row predating migration 086, so it counts
 *     as a still and never feeds an UNKNOWN line. The scene-axis coverage
 *     line measures a different null entirely (the axes that were never
 *     supplied), and conflating the two would make coverage meaningless on
 *     day one.
 *
 * A `.mp4`-shaped media URL is the one positive fallback for a pre-086 row:
 * it is evidence the row IS video, never evidence that a null one is.
 */
export function isVideoRow(row: SocialMixReportRow): boolean {
  if (row.mediaKind === 'video') return true
  if (row.mediaKind === 'image') return false
  return (row.mediaUrls ?? []).some(u => typeof u === 'string' && /\.(mp4|mov|m4v)(\?|$)/i.test(u))
}

function chargeTierOf(row: SocialMixReportRow): 'ceiling' | 'mid' | null {
  if (!row.bodyZone) return null
  if (CEILING_ZONES.has(row.bodyZone)) return 'ceiling'
  if (MID_ZONES.has(row.bodyZone)) return 'mid'
  return null
}

function bandLine(label: string, actual: number, window: number, floor: number, ceiling: number, unit = ''): MixReportLine {
  const inBand = actual >= floor && actual <= ceiling
  const bandText = floor === ceiling ? `${floor}` : `${floor}-${ceiling}`
  return {
    label,
    detail: `${actual}${unit} / ${window} (target band ${bandText}${unit})${inBand ? '' : ' -- BREACH'}`,
    status: inBand ? 'ok' : 'breach',
  }
}

function minFloorLine(label: string, actual: number, window: number, min: number): MixReportLine {
  const ok = actual >= min
  return {
    label,
    detail: `${actual} / ${window} (floor ${min})${ok ? '' : ' -- BREACH'}`,
    status: ok ? 'ok' : 'breach',
  }
}

function maxCapLine(label: string, actual: number, window: number, cap: number, extraBreach: boolean, extraNote?: string): MixReportLine {
  const breach = actual > cap || extraBreach
  const note = extraBreach && extraNote ? ` -- BREACH (${extraNote})` : breach ? ' -- BREACH' : ''
  return {
    label,
    detail: `${actual} / ${window} (cap ${cap})${note}`,
    status: breach ? 'breach' : 'ok',
  }
}

/**
 * "No repeat inside N consecutive frames that carry this axis." Shared by the
 * body-zone (#10267) and contact-mode (#10340) windows so the two read
 * identically on the page and cannot drift apart.
 */
function repeatWindowLine(label: string, values: string[], window: number): MixReportLine {
  const windowValues = values.slice(0, window)
  const seen = new Set<string>()
  let repeat = false
  for (const v of windowValues) {
    if (seen.has(v)) { repeat = true; break }
    seen.add(v)
  }
  return {
    label,
    detail: `${windowValues.length} frame(s) checked, ${repeat ? 'REPEAT FOUND' : 'no repeat'}` + (repeat ? ' -- BREACH' : ''),
    status: repeat ? 'breach' : 'ok',
  }
}

function unknownLine(label: string, reason: string): MixReportLine {
  return { label, detail: `UNKNOWN (${reason})`, status: 'unknown' }
}

/**
 * Pure. `rows` must be ordered newest-first (the same order
 * `.orderBy(desc(postedAt))` returns) -- exactly the last N posted+approved
 * Instagram rows, however many the caller fetched. No DB, no network, no
 * clock reads: fully deterministic from its input, which is what makes it
 * unit-testable without a database.
 */
export function computeSocialMixReport(
  allRows: SocialMixReportRow[],
  platform: MixReportPlatform = 'instagram',
  extras: SocialMixReportExtras = {},
): SocialMixReport {
  // Stills only, for every window below (#10478 defect 2). A reel sitting in
  // the Instagram denominator shrinks each on-skin count while the rolling-7
  // still holds 7 rows, which is how a week of video made every 3.2c line
  // read green. The video rows get their own line instead of vanishing.
  const rows = allRows.filter(r => !isVideoRow(r))
  const videoIn7 = allRows.slice(0, CHARGE_WINDOW).filter(isVideoRow).length
  const last7 = rows.slice(0, CHARGE_WINDOW)
  const last14 = rows.slice(0, PRODUCT_WINDOW)

  // --- Axis coverage: how many of the last 7 stills carry all four axes ---
  // The line ticket #10479 exists to move. 0/7 is the state migrations 093
  // and 099 both shipped into, twice, undetected.
  const coveredIn7 = last7.filter(r => hasAllSceneAxes({
    bodyZone: r.bodyZone ?? undefined,
    contactMode: r.contactMode ?? undefined,
    cropScale: r.cropScale ?? undefined,
    sceneLocation: r.sceneLocation ?? undefined,
  })).length
  const coverage = minFloorLine('Axis coverage (last 7)', coveredIn7, CHARGE_WINDOW, CHARGE_WINDOW)

  // --- Video rows in the newest 7 posts of this feed ---
  const videoRows: MixReportLine = videoIn7 === 0
    ? { label: 'Video rows (last 7 posts)', detail: `0 / ${CHARGE_WINDOW} (stills windows undiluted)`, status: 'ok' }
    : {
        label: 'Video rows (last 7 posts)',
        detail:
          `${videoIn7} / ${CHARGE_WINDOW} video row(s), axes UNKNOWN ` +
          '(excluded from the stills windows; nothing on the video path writes them)',
        status: 'unknown',
      }

  // --- Removals in the last 30 days: the outcome the caps exist to prevent ---
  const removals = extras.removals30d == null
    ? unknownLine('Removals (last 30d)', 'removal count could not be read')
    : {
        label: 'Removals (last 30d)',
        detail: `${extras.removals30d} platform-attributed removal(s)` + (extras.removals30d > 0 ? ' -- BREACH' : ''),
        status: (extras.removals30d > 0 ? 'breach' : 'ok') as LineStatus,
      }

  // --- Charge tier (ceiling / mid / educational) ---
  // "Educational" has no column anywhere in social_posts that encodes charge
  // tier for non-on-skin frames (postType is auto_deal|thread_reply|manual|
  // campaign|video_reel|video_short -- a delivery mechanism, not a pillar).
  // Ceiling/mid are computed from bodyZone per #10272 item 6; educational is
  // always UNKNOWN rather than backed into from "not ceiling, not mid" (that
  // would silently misclassify every non-on-skin ceiling frame -- a full
  // scene composition, a cast frame -- as educational, which is exactly the
  // hidden-drift failure this ticket exists to stop).
  const bodyZoneKnownIn7 = last7.filter(zoneIsKnown).length
  let ceiling: MixReportLine
  let mid: MixReportLine
  const educational = unknownLine('Educational (last 7)', 'no column encodes charge tier for non-on-skin frames')
  if (bodyZoneKnownIn7 === 0) {
    ceiling = unknownLine('Ceiling (last 7)', 'body_zone unpopulated on every row in window')
    mid = unknownLine('Mid (last 7)', 'body_zone unpopulated on every row in window')
  } else {
    const ceilingCount = last7.filter(r => chargeTierOf(r) === 'ceiling').length
    const midCount = last7.filter(r => chargeTierOf(r) === 'mid').length
    ceiling = bandLine(
      'Ceiling (last 7)', ceilingCount, CHARGE_WINDOW,
      CHARGE_TARGETS.ceiling - CHARGE_TOLERANCE, CHARGE_TARGETS.ceiling + CHARGE_TOLERANCE,
    )
    mid = bandLine(
      'Mid (last 7)', midCount, CHARGE_WINDOW,
      CHARGE_TARGETS.mid - CHARGE_TOLERANCE, CHARGE_TARGETS.mid + CHARGE_TOLERANCE,
    )
  }

  // --- Close crop (cap 3 per rolling 7, never two consecutive) ---
  const cropKnownIn7 = last7.filter(r => r.cropScale != null).length
  let closeCrop: MixReportLine
  if (cropKnownIn7 === 0) {
    closeCrop = unknownLine('Close crop (last 7)', 'crop_scale unpopulated on every row in window')
  } else {
    const closeCropCount = last7.filter(r => r.cropScale && CLOSE_CROP_SCALES.has(r.cropScale)).length
    let twoConsecutive = false
    for (let i = 0; i < last7.length - 1; i++) {
      const a = last7[i]!.cropScale
      const b = last7[i + 1]!.cropScale
      if (a && b && CLOSE_CROP_SCALES.has(a) && CLOSE_CROP_SCALES.has(b)) { twoConsecutive = true; break }
    }
    closeCrop = maxCapLine('Close crop (last 7)', closeCropCount, CHARGE_WINDOW, CLOSE_CROP_CAP, twoConsecutive, 'two consecutive close crops')
  }

  // --- Product-forward / product-free (last 14, ticket #10110's criteria) ---
  const productForwardCount = last14.filter(isProductForward).length
  const productFreeCount = last14.length - productForwardCount
  const pfFloor = Math.round(PRODUCT_WINDOW * PRODUCT_FORWARD_FLOOR_SHARE)
  const pfCeiling = Math.round(PRODUCT_WINDOW * PRODUCT_FORWARD_CEILING_SHARE)
  const productForward = bandLine('Product-forward (last 14)', productForwardCount, PRODUCT_WINDOW, pfFloor, pfCeiling)
  const productFreeCap = PRODUCT_WINDOW - pfFloor
  const productFreeOverCap = productFreeCount > productFreeCap
  const productFreeUnderFloor = productFreeCount < PRODUCT_FREE_MIN
  const productFree: MixReportLine = {
    label: 'Product-free (last 14)',
    detail: `${productFreeCount} / ${PRODUCT_WINDOW} (floor ${PRODUCT_FREE_MIN}, cap ${productFreeCap})` +
      (productFreeOverCap ? ' -- BREACH (over cap)' : productFreeUnderFloor ? ' -- BREACH (under floor)' : ''),
    status: (productFreeOverCap || productFreeUnderFloor) ? 'breach' : 'ok',
  }

  // --- Body-zone window: no repeat inside 5 consecutive on-skin frames ---
  // `none` is a known answer, not a zone: it never enters the repeat window.
  const onSkin = rows.filter(isOnSkin)
  let bodyZoneWindow: MixReportLine
  if (onSkin.length === 0) {
    bodyZoneWindow = unknownLine('Body-zone window (last 5 on-skin)', 'body_zone unpopulated on every row')
  } else {
    const windowRows = onSkin.slice(0, BODY_ZONE_WINDOW)
    const seen = new Set<string>()
    let repeat = false
    for (const r of windowRows) {
      if (seen.has(r.bodyZone!)) { repeat = true; break }
      seen.add(r.bodyZone!)
    }
    bodyZoneWindow = {
      label: 'Body-zone window (last 5 on-skin)',
      detail: `${windowRows.length} on-skin frame(s) checked, ${repeat ? 'REPEAT FOUND' : 'no repeat'}` +
        (repeat ? ' -- BREACH' : ''),
      status: repeat ? 'breach' : 'ok',
    }
  }

  // --- Contact-mode window: no repeat inside 5 consecutive on-skin frames ---
  const contacted = rows.filter(r => r.contactMode != null && r.contactMode !== NON_SKIN_SENTINEL)
  const contactModeWindow = contacted.length === 0
    ? unknownLine('Contact-mode window (last 5 on-skin)', 'contact_mode unpopulated on every row')
    : repeatWindowLine('Contact-mode window (last 5 on-skin)', contacted.map(r => r.contactMode!), CONTACT_MODE_WINDOW)

  // --- Location window: no repeat inside 8 consecutive product posts ---
  const located = rows.filter(r => r.sceneLocation != null)
  let locationWindow: MixReportLine
  if (located.length === 0) {
    locationWindow = unknownLine('Location window (last 8)', 'scene_location unpopulated on every row')
  } else {
    const windowRows = located.slice(0, LOCATION_WINDOW)
    const seen = new Set<string>()
    let repeat = false
    for (const r of windowRows) {
      if (seen.has(r.sceneLocation!)) { repeat = true; break }
      seen.add(r.sceneLocation!)
    }
    locationWindow = {
      label: 'Location window (last 8)',
      detail: `${windowRows.length} located frame(s) checked, ${repeat ? 'REPEAT FOUND' : 'no repeat'}` +
        (repeat ? ' -- BREACH' : ''),
      status: repeat ? 'breach' : 'ok',
    }
  }

  // --- Lube-treatment repeats: no column exists anywhere, always UNKNOWN ---
  const lubeTreatment = unknownLine(
    'Lube-treatment repeats',
    'no lube_treatment (or equivalent) column exists in social_posts',
  )

  // --- Cast rotation + volume (§3.2b) ---
  // A row whose `castSlugs` is null never had the column sent; an empty array
  // is a known cast-free frame. Only the first case is UNKNOWN -- guessing 0
  // cast frames from unsent data is exactly the false-negative "in band" this
  // module refuses to print.
  const castKnown = rows.filter(r => r.castSlugs != null)
  let castRotation: MixReportLine
  let castVolume: MixReportLine
  if (castKnown.length === 0) {
    castRotation = unknownLine('Cast rotation (any 5 consecutive cast frames)', 'cast_slugs unpopulated on every row')
    castVolume = unknownLine('Cast frames (last 14)', 'cast_slugs unpopulated on every row')
  } else {
    const castFrames = castKnown.filter(r => (r.castSlugs?.length ?? 0) > 0)
    const castIn14 = last14.filter(r => (r.castSlugs?.length ?? 0) > 0).length
    castVolume = maxCapLine('Cast frames (last 14)', castIn14, CAST_VOLUME_WINDOW, CAST_VOLUME_CAP, false)

    // Every sliding window of 5 consecutive cast frames, not just the newest:
    // a face that carried 3 of frames 2-6 is the drift the floor exists to
    // catch even when the newest 5 happen to be clean.
    let worstSlug: string | null = null
    let worstCount = 0
    const lastWindowStart = Math.max(0, castFrames.length - CAST_ROTATION_WINDOW)
    for (let start = 0; start <= lastWindowStart; start++) {
      const windowFrames = castFrames.slice(start, start + CAST_ROTATION_WINDOW)
      const counts = new Map<string, number>()
      for (const frame of windowFrames) {
        for (const slug of new Set(frame.castSlugs ?? [])) {
          counts.set(slug, (counts.get(slug) ?? 0) + 1)
        }
      }
      for (const [slug, n] of counts) {
        if (n > worstCount) { worstCount = n; worstSlug = slug }
      }
    }
    const rotationBreach = worstCount > CAST_ROTATION_CAP
    castRotation = {
      label: 'Cast rotation (any 5 consecutive cast frames)',
      detail: `${castFrames.length} cast frame(s) checked, busiest face ${worstCount}` +
        (worstSlug ? ` (${worstSlug})` : '') +
        ` (cap ${CAST_ROTATION_CAP})` + (rotationBreach ? ' -- BREACH' : ''),
      status: rotationBreach ? 'breach' : 'ok',
    }
  }

  // --- Wide ceiling frame: at least 1 per rolling 7 that reads a location ---
  let wideCeiling: MixReportLine
  if (bodyZoneKnownIn7 === 0 || cropKnownIn7 === 0) {
    wideCeiling = unknownLine(
      'Wide ceiling frame (last 7)',
      bodyZoneKnownIn7 === 0
        ? 'body_zone unpopulated on every row in window'
        : 'crop_scale unpopulated on every row in window',
    )
  } else {
    const wideCount = last7.filter(
      r => chargeTierOf(r) === 'ceiling' && r.cropScale != null && WIDE_CEILING_SCALES.has(r.cropScale),
    ).length
    wideCeiling = minFloorLine('Wide ceiling frame (last 7)', wideCount, CHARGE_WINDOW, WIDE_CEILING_MIN)
  }

  // --- Plug between the cheeks: at most 1 per rolling 7 ---
  const plug = bodyZoneKnownIn7 === 0
    ? unknownLine('Plug between cheeks (last 7)', 'body_zone unpopulated on every row in window')
    : maxCapLine(
        'Plug between cheeks (last 7)',
        last7.filter(r => r.bodyZone === PLUG_ZONE).length,
        CHARGE_WINDOW, PLUG_CAP, false,
      )

  // --- Carousel count (last 14, floor 1) ---
  const carouselCount = last14.filter(isCarousel).length
  const carousel = minFloorLine('Carousel (last 14)', carouselCount, PRODUCT_WINDOW, CAROUSEL_MIN)

  const lines = {
    coverage, videoRows, removals,
    ceiling, mid, educational, closeCrop, productForward, productFree,
    bodyZoneWindow, contactModeWindow, locationWindow,
    castRotation, castVolume, wideCeiling, plug, lubeTreatment, carousel,
  }
  // Non-ok, not breach-only (#10478 defect 1). An unpopulated column is the
  // most-decayed signal in the system and it used to read clean.
  const anyBreach = Object.values(lines).some(l => l.status !== 'ok')
  const worstStatus: LineStatus = Object.values(lines).some(l => l.status === 'breach')
    ? 'breach'
    : anyBreach ? 'unknown' : 'ok'

  return { sampleSize: rows.length, platform, lines, anyBreach, worstStatus }
}

/**
 * Both feeds from one row list. Instagram and X share the imagery fence but
 * the caps are per feed, so each gets its own windows; X is the surface that
 * cannot label sensitive media, which is precisely why it may not be left
 * out of the measurement.
 */
export function computeSocialMixReportBundle(
  rows: SocialMixReportRow[],
  extras: Partial<Record<MixReportPlatform, SocialMixReportExtras>> = {},
): SocialMixReportBundle {
  const instagram = computeSocialMixReport(
    rows.filter(r => r.platform === 'instagram'), 'instagram', extras.instagram ?? {},
  )
  const x = computeSocialMixReport(
    rows.filter(r => r.platform === 'x'), 'x', extras.x ?? {},
  )
  const anyBreach = instagram.anyBreach || x.anyBreach
  const worstStatus: LineStatus =
    instagram.worstStatus === 'breach' || x.worstStatus === 'breach' ? 'breach'
      : anyBreach ? 'unknown' : 'ok'
  return { instagram, x, anyBreach, worstStatus }
}

const LINE_ORDER: (keyof SocialMixReport['lines'])[] = [
  'coverage', 'videoRows', 'removals',
  'ceiling', 'mid', 'educational', 'closeCrop', 'productForward', 'productFree',
  'bodyZoneWindow', 'contactModeWindow', 'locationWindow',
  'castRotation', 'castVolume', 'wideCeiling', 'plug', 'lubeTreatment', 'carousel',
]

/**
 * Plain-text lines for the social run summary (routine-social-daily.md Step 7)
 * and log output. Every line names its feed, because the caps are per feed and
 * an unlabelled line invites exactly the aggregation this report stopped doing.
 */
export function formatSocialMixReportLines(
  report: SocialMixReport | SocialMixReportBundle,
): string[] {
  if ('lines' in report) {
    return LINE_ORDER.map(key => {
      const line = report.lines[key]
      const marker = line.status === 'breach' ? 'BREACH' : line.status === 'unknown' ? 'UNKNOWN' : 'ok'
      return `[mix-report] ${report.platform} ${line.label}: ${line.detail} (${marker})`
    })
  }
  return [
    ...formatSocialMixReportLines(report.instagram),
    ...formatSocialMixReportLines(report.x),
  ]
}

const LINE_LABELS: Record<keyof SocialMixReport['lines'], string> = {
  coverage: 'Axis coverage (last 7)',
  videoRows: 'Video rows (last 7 posts)',
  removals: 'Removals (last 30d)',
  ceiling: 'Ceiling (last 7)',
  mid: 'Mid (last 7)',
  educational: 'Educational (last 7)',
  closeCrop: 'Close crop (last 7)',
  productForward: 'Product-forward (last 14)',
  productFree: 'Product-free (last 14)',
  bodyZoneWindow: 'Body-zone window (last 5 on-skin)',
  contactModeWindow: 'Contact-mode window (last 5 on-skin)',
  locationWindow: 'Location window (last 8)',
  castRotation: 'Cast rotation (any 5 consecutive cast frames)',
  castVolume: 'Cast frames (last 14)',
  wideCeiling: 'Wide ceiling frame (last 7)',
  plug: 'Plug between cheeks (last 7)',
  lubeTreatment: 'Lube-treatment repeats',
  carousel: 'Carousel (last 14)',
}

/**
 * Every line UNKNOWN, never a guessed 0/BREACH. Used when the report
 * genuinely could not be computed (e.g. a DB read failed) so a caller (the
 * admin page, the routine's summary) degrades instead of crashing or
 * printing a false-negative "in band" -- the exact class of bug in
 * `MEMORY.md`'s "merged != applied migration" precedent: code shipped
 * assuming a column exists before the migration that adds it has actually
 * run against the live database.
 */
function unavailableReport(platform: MixReportPlatform, reason: string): SocialMixReport {
  const lines = {} as SocialMixReport['lines']
  for (const key of LINE_ORDER) lines[key] = unknownLine(LINE_LABELS[key], reason)
  // anyBreach is true because every line is UNKNOWN and UNKNOWN is not ok
  // (#10478). A read failure that reported "in band" would be the same
  // false-negative this module exists to stop.
  return { sampleSize: 0, platform, lines, anyBreach: true, worstStatus: 'unknown' }
}

function unavailableBundle(reason: string): SocialMixReportBundle {
  return {
    instagram: unavailableReport('instagram', reason),
    x: unavailableReport('x', reason),
    anyBreach: true,
    worstStatus: 'unknown',
  }
}

// --- DB wrapper -------------------------------------------------------

export interface GetSocialMixReportDeps {
  /**
   * The last `limit` posted+approved rows on BOTH fenced feeds (Instagram and
   * X), newest first. One query; the pure function splits them per platform.
   */
  loadRows: (limit: number) => Promise<SocialMixReportRow[]>
  /**
   * Platform-attributed removals in the last `days` days, per platform. The
   * outcome variable: measuring inputs with no result next to them is how a
   * report-only regime stops meaning anything.
   */
  loadRemovals: (days: number) => Promise<Record<MixReportPlatform, number>>
}

// Comfortably larger than every window used above (max 14, plus enough slack
// for the on-skin/location windows to find their 5/8 within a sparser
// subset of a longer history). Per platform, not global: both feeds come out
// of one query and the quieter one must not be starved out of its own window
// by the louder one.
const DEFAULT_FETCH_LIMIT = 60
const REMOVAL_WINDOW_DAYS = 30

/** 'instagram' | 'x' only; anything else is not on the shared imagery fence. */
function asMixPlatform(value: string | null | undefined): MixReportPlatform | null {
  return (MIX_REPORT_PLATFORMS as readonly string[]).includes(value ?? '')
    ? (value as MixReportPlatform)
    : null
}

async function liveLoadRows(limit: number): Promise<SocialMixReportRow[]> {
  const { db } = await import('./db.server')
  const { socialPosts } = await import('../../db/schema')
  const { and, eq, desc, inArray } = await import('drizzle-orm')
  const rows = await db
    .select({
      id: socialPosts.id,
      platform: socialPosts.platform,
      mediaKind: socialPosts.mediaKind,
      shopifyProductId: socialPosts.shopifyProductId,
      mediaUrls: socialPosts.mediaUrls,
      bodyZone: socialPosts.bodyZone,
      contactMode: socialPosts.contactMode,
      cropScale: socialPosts.cropScale,
      sceneLocation: socialPosts.sceneLocation,
      castSlugs: socialPosts.castSlugs,
    })
    .from(socialPosts)
    .where(and(
      // Both fenced feeds (#10478 defect 3). The Surfaces paragraph of 3.2c:
      // "Instagram and X share one imagery fence until X can label sensitive
      // media", and X is the one that cannot label.
      inArray(socialPosts.platform, [...MIX_REPORT_PLATFORMS]),
      eq(socialPosts.status, 'posted'),
      eq(socialPosts.reviewStatus, 'approved'),
    ))
    .orderBy(desc(socialPosts.postedAt))
    .limit(limit * MIX_REPORT_PLATFORMS.length)
  return rows.flatMap(r => {
    const platform = asMixPlatform(r.platform)
    if (!platform) return []
    return [{
      id: r.id,
      platform,
      mediaKind: r.mediaKind ?? null,
      shopifyProductId: r.shopifyProductId ?? null,
      mediaUrls: r.mediaUrls ?? null,
      bodyZone: r.bodyZone ?? null,
      contactMode: r.contactMode ?? null,
      cropScale: r.cropScale ?? null,
      sceneLocation: r.sceneLocation ?? null,
      castSlugs: r.castSlugs ?? null,
    }]
  })
}

/**
 * Removals per platform in the window. Mirrors `countRemovedSince` in
 * `social-removal-watch.server.ts`, including its `removalSource != 'owner'`
 * exclusion: a post the owner took down himself is not a takedown signal.
 */
async function liveLoadRemovals(days: number): Promise<Record<MixReportPlatform, number>> {
  const { db } = await import('./db.server')
  const { socialPosts } = await import('../../db/schema')
  const { and, eq, gte, ne, inArray, sql } = await import('drizzle-orm')
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({ platform: socialPosts.platform, n: sql<number>`count(*)::int` })
    .from(socialPosts)
    .where(and(
      inArray(socialPosts.platform, [...MIX_REPORT_PLATFORMS]),
      eq(socialPosts.status, 'deleted'),
      gte(socialPosts.postedAt, since),
      ne(socialPosts.removalSource, 'owner'),
    ))
    .groupBy(socialPosts.platform)
  const out: Record<MixReportPlatform, number> = { instagram: 0, x: 0 }
  for (const r of rows) {
    const platform = asMixPlatform(r.platform)
    if (platform) out[platform] = r.n
  }
  return out
}

/**
 * Fetches the last N posted+approved rows on both fenced feeds and computes
 * one report per feed. Not a gate. Never throws: a read failure degrades to
 * an all-UNKNOWN bundle rather than taking down whatever page or routine
 * called this, and an all-UNKNOWN bundle now reports `anyBreach: true`,
 * because "we could not look" must never render as "in band".
 *
 * The removal count is fetched independently of the window rows, so a failure
 * there costs only that line (it prints UNKNOWN) instead of the whole report.
 */
export async function getSocialMixReport(
  over: Partial<GetSocialMixReportDeps> = {},
): Promise<SocialMixReportBundle> {
  const loadRows = over.loadRows ?? liveLoadRows
  const loadRemovals = over.loadRemovals ?? liveLoadRemovals
  let removals: Record<MixReportPlatform, number> | null = null
  try {
    removals = await loadRemovals(REMOVAL_WINDOW_DAYS)
  } catch (err) {
    console.error('[social-mix-report] removal count failed, that line degrades to UNKNOWN:', err)
  }
  try {
    const rows = await loadRows(DEFAULT_FETCH_LIMIT)
    return computeSocialMixReportBundle(rows, {
      instagram: { removals30d: removals?.instagram ?? null },
      x: { removals30d: removals?.x ?? null },
    })
  } catch (err) {
    console.error('[social-mix-report] getSocialMixReport failed, degrading to UNKNOWN:', err)
    return unavailableBundle('report read failed, see server logs')
  }
}
