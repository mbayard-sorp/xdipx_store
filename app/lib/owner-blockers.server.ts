/**
 * The owner blocker list (078): the things only Mike can clear, as rows.
 *
 * The daily digest already had a "Needs Mike" section, but it could only see
 * blockers that already had a row somewhere: a blocked ticket, a needs-owner
 * PR, an approved promo. The blockers that actually stall features get decided
 * in conversation and land in prose. "Apply migration 068." "Allowlist
 * *.fal.media." "Enable Imagen billing." "Flip the trend valve." Those lived
 * in docs/store-team/ops-blockers.md, in a memory file, or nowhere, and
 * nothing could tell you whether they were still true a week later.
 *
 * Two things make this different from the doc it replaces:
 *
 *   1. A blocker has an identity (dedupe_key), so the doc parser, the DB
 *      sweep, and the transcript miner all collapse onto one row instead of
 *      three, and re-observing it ages the row instead of duplicating it.
 *   2. A blocker carries a PROBE wherever a machine check exists, so the list
 *      closes its own rows the moment the owner does the thing. A list that
 *      needs hand-curation rots into exactly the artifact it replaced.
 *
 * Every probe is read-only. Probe args come from agents, so identifiers are
 * validated against a strict pattern and checked against information_schema
 * before they are ever interpolated; values are always bound.
 *
 * Server-only.
 */

import { sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { canonicalDedupeKey, findNearDuplicate } from '~/lib/dedupe-key'

/* Types, probe phrasing, and the email renderer are pure and live in
 * owner-blockers-core so /admin/blockers can use them without pulling the Neon
 * client into the client bundle. Re-exported here so server callers have one
 * import. */
export * from '~/lib/owner-blockers-core'
import {
  BLOCKER_CATEGORIES,
  suggestProbeFor,
  probeGapReason,
  BLOCKER_SOURCES,
  PROBE_DESCRIPTIONS,
  blockerEmailSubject,
  isIdent,
  isProbe,
  renderBlockerEmail,
  titleClaimsConfirmed,
  type BlockerInput,
  type OwnerBlocker,
  type ProbeVerdict,
} from '~/lib/owner-blockers-core'

async function tableExists(table: string): Promise<ProbeVerdict> {
  if (!isIdent(table)) return null
  const res = await db.execute(sql`
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ${table} LIMIT 1`)
  return (res.rows ?? []).length > 0
}

async function columnExists(arg: string): Promise<ProbeVerdict> {
  const [table, column] = arg.split('.')
  if (!table || !column || !isIdent(table) || !isIdent(column)) return null
  const res = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
     LIMIT 1`)
  return (res.rows ?? []).length > 0
}

async function settingIs(key: string, want: string): Promise<ProbeVerdict> {
  if (!key || key.length > 64) return null
  const res = await db.execute(sql`
    SELECT value FROM pipeline_settings WHERE key = ${key} LIMIT 1`)
  const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined
  if (!row) return want === 'false' ? true : false
  return String(row['value'] ?? '') === want
}

/**
 * Does this table have any rows at all? The table name is validated as an
 * identifier AND confirmed to exist in information_schema before it is
 * interpolated, since a dynamic relation cannot be a bound parameter.
 */
async function rowsExist(table: string): Promise<ProbeVerdict> {
  if (!isIdent(table)) return null
  const exists = await tableExists(table)
  if (exists !== true) return null
  const res = await db.execute(sql`SELECT 1 FROM ${sql.raw(`"${table}"`)} LIMIT 1`)
  return (res.rows ?? []).length > 0
}

/** 'team|run_type|days' — has this routine written a run row recently? */
async function routineRan(arg: string): Promise<ProbeVerdict> {
  const [team, runType, daysRaw] = arg.split('|')
  if (!team || !runType) return null
  const days = Math.min(Math.max(parseInt(daysRaw ?? '7', 10) || 7, 1), 90)
  const res = await db.execute(sql`
    SELECT 1 FROM homepage_team_runs
     WHERE team = ${team} AND run_type = ${runType}
       AND started_at >= now() - (${String(days)} || ' days')::interval
     LIMIT 1`)
  return (res.rows ?? []).length > 0
}

export interface ProbeDef {
  /** Human phrasing of what would clear the row, shown on /admin/blockers. */
  describe: (arg: string) => string
  run: (arg: string) => Promise<ProbeVerdict>
}

/**
 * Is a Shopify webhook topic registered? Arg is a topic (`ORDERS_CREATE`) or
 * `all` for the whole expected set.
 *
 * This probe exists because of a specific, repeatable wrong answer. On
 * 2026-08-21 a P1 blocker read "CONFIRMED: zero Shopify webhooks registered in
 * production", independently repeated by R-DEV and by QA. All six existed.
 * **Shopify scopes `webhookSubscriptions` to the app making the query**, so an
 * app only ever sees its own; the zero came from asking through a different app
 * than the one that owns them.
 *
 * That made the blocker actively dangerous: its remedy was to register via the
 * Admin UI, which issues a different HMAC secret than `verifyShopifyWebhook`
 * checks, so following it would have added six subscriptions that 401 forever
 * while the working ones kept running.
 *
 * So this runner always uses `SHOPIFY_ADMIN_ACCESS_TOKEN`, the custom-app token
 * paired with `SHOPIFY_WEBHOOK_SECRET`. Missing credentials return `null`
 * (cannot tell), never `false`. "I could not ask" and "it is not there" are
 * different answers, and collapsing them is exactly how this became a P1.
 */
async function webhookRegistered(arg: string): Promise<ProbeVerdict> {
  const domain = (process.env['SHOPIFY_STORE_DOMAIN'] ?? '').trim().replace(/\\n$/, '')
  const token = (process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? '').trim()
  if (!domain || !token) return null

  let topics: string[]
  try {
    const res = await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ webhookSubscriptions(first: 100) { nodes { topic } } }' }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { data?: { webhookSubscriptions?: { nodes?: Array<{ topic?: string }> } } }
    const nodes = body.data?.webhookSubscriptions?.nodes
    if (!nodes) return null
    topics = nodes.map(n => String(n.topic ?? ''))
  } catch {
    return null
  }

  if (arg === 'all') return EXPECTED_WEBHOOK_TOPICS.every(t => topics.includes(t))
  return topics.includes(arg)
}

/** Mirrors EXPECTED_WEBHOOKS in scripts/check-shopify-webhooks.ts. */
const EXPECTED_WEBHOOK_TOPICS: readonly string[] = [
  'ORDERS_CREATE',
  'ORDERS_FULFILLED',
  'PRODUCTS_CREATE',
  'PRODUCTS_UPDATE',
  'INVENTORY_LEVELS_UPDATE',
  'RETURNS_UPDATE',
]

/**
 * Is any RunPod pod (the hourly-billed Pods product) currently RUNNING? A
 * forgotten bootstrap pod costs $0.74/hr with nothing to show for it. The
 * incident that motivated this probe left one running 18.7h (~$14) on
 * 2026-08-22/23. Arg is unused. `null` on any API error (missing/scoped key,
 * non-2xx): "could not ask" must never collapse into "all clear".
 */
async function runpodNoPods(): Promise<ProbeVerdict> {
  try {
    const { listRunningRunpodPods } = await import('~/lib/runpod-pods.server')
    const running = await listRunningRunpodPods()
    return running.length === 0
  } catch {
    return null
  }
}

/**
 * Has the video render ENDPOINT scaled to zero active workers with an empty
 * queue? The pods probe above cannot see the serverless endpoint at all, so
 * without this the render fleet has a permanent false all-clear. `null` when
 * the API is unreachable OR RUNPOD_VIDEO_ENDPOINT_ID is unset: the unset-env
 * case is a "succeeded but empty" read guardedRun cannot catch, and it must
 * never read as idle.
 */
async function runpodEndpointIdle(): Promise<ProbeVerdict> {
  try {
    if (!process.env['RUNPOD_VIDEO_ENDPOINT_ID']) return null
    const { getRunpodEndpointHealth } = await import('~/lib/runpod-endpoint.server')
    const health = await getRunpodEndpointHealth()
    return health.workers.active === 0 && health.jobs.inQueue === 0 && health.jobs.inProgress === 0
  } catch {
    return null
  }
}

/**
 * True when `platform` has no approved draft left days past its slot.
 *
 * Asks `findOverdueApproved`, the same read the blocker was filed from, so the
 * probe cannot disagree with the condition it is verifying. An unrecognised
 * platform is a could-not-ask rather than a clear: answering `true` for a typo
 * would close a real blocker on the strength of a scope error, which is the
 * exact failure the null-not-false rule above exists to prevent.
 */
async function socialNoOverdue(platform: string): Promise<ProbeVerdict> {
  const { findOverdueApproved } = await import('./social-publish-job.server')
  const { AUTO_PUBLISH_PLATFORMS } = await import('./team-keys')
  if (!(AUTO_PUBLISH_PLATFORMS as readonly string[]).includes(platform)) return null
  const overdue = await findOverdueApproved(platform as 'instagram' | 'x')
  return overdue.length === 0
}


/* ── Probes added 2026-09-02 (audit Stage A) ──────────────────────────────────
 *
 * Of 32 blockers ever filed, 25 carried no probe and 15 of those were cleared
 * by the owner's own hand. The vocabulary had ten kinds and none of them could
 * answer the four questions the open list actually asked: is this env var set,
 * did this PR merge, is this CI check green, is this endpoint up.
 *
 * Every one of these owns the "could not ask" half of the #4702 invariant for
 * its own source: an unconfigured GitHub client, a network failure, a malformed
 * arg — all `null`, never `false`.
 */

/**
 * Is this env var set in the app's own process?
 *
 * Deliberately answers "has it reached the app", not "is it in the Vercel
 * dashboard" — which the app cannot see, and which is the weaker question
 * anyway: a value set but not yet redeployed has not reached anything, and the
 * row should stay open until it has. Comma-separated args require all of them.
 */
async function envPresent(arg: string): Promise<ProbeVerdict> {
  const names = arg.split(',').map(n => n.trim()).filter(Boolean)
  if (names.length === 0) return null
  return names.every(n => {
    const v = process.env[n]
    return typeof v === 'string' && v.trim().length > 0
  })
}

/** Is this PR merged? Arg is a PR number or any URL ending in one. */
async function prMerged(arg: string): Promise<ProbeVerdict> {
  const m = /(\d+)\s*$/.exec(arg.trim())
  if (!m) return null
  const { getPullRequest, isGithubConfigured } = await import('~/lib/github.server')
  if (!isGithubConfigured()) return null
  const res = await getPullRequest(Number(m[1]), 'blocker-probe')
  // A failed lookup is a could-not-ask: a 404 can mean a typo'd number just as
  // easily as a PR that does not exist, and neither is proof it did not merge.
  if (!res.ok || !res.data) return null
  return res.data.merged === true
}

/**
 * Is a named check green? Arg is `<checkName>` (against main's head) or
 * `<checkName>|<ref>`.
 */
async function checkGreen(arg: string): Promise<ProbeVerdict> {
  const [rawName, rawRef] = arg.split('|')
  const name = (rawName ?? '').trim()
  if (!name) return null
  const { getRef, getChecksForRef, checkConclusion, isGithubConfigured } =
    await import('~/lib/github.server')
  if (!isGithubConfigured()) return null

  let sha = (rawRef ?? '').trim()
  if (!sha) {
    const ref = await getRef('heads/main', 'blocker-probe')
    if (!ref.ok || !ref.data) return null
    sha = ref.data.sha
  }
  const report = await getChecksForRef(sha, 'blocker-probe')
  if (!report.ok || !report.data) return null
  const conclusion = checkConclusion(report.data, name)
  // Not reported yet is not the same as red. Only a real conclusion decides.
  if (conclusion == null) return null
  return conclusion === 'success'
}

/** Does this URL answer 2xx? */
async function endpoint200(arg: string): Promise<ProbeVerdict> {
  const url = arg.trim()
  if (!/^https?:\/\//i.test(url)) return null
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  })
  // Reached and answered: that is authoritative either way. A throw (DNS,
  // timeout, egress rule) is a could-not-ask and guardedRun maps it to null —
  // an endpoint unreachable from THIS network is not proof it is down.
  return res.status >= 200 && res.status < 300
}

const RUNNERS: Record<string, (arg: string) => Promise<ProbeVerdict>> = {
  table_exists:  tableExists,
  column_exists: columnExists,
  setting_true:  a => settingIs(a, 'true'),
  setting_false: a => settingIs(a, 'false'),
  rows_exist:    rowsExist,
  routine_ran:   routineRan,
  webhook_registered: webhookRegistered,
  runpod_no_pods: runpodNoPods,
  runpod_endpoint_idle: runpodEndpointIdle,
  social_no_overdue: socialNoOverdue,
  env_present:   envPresent,
  pr_merged:     prMerged,
  check_green:   checkGreen,
  endpoint_200:  endpoint200,
}

/**
 * Vocabulary-wide "could not ask -> null, never false" guarantee (#4702).
 *
 * A thrown error is always a could-not-ask (the DB was unreachable, a fetch
 * raised, an arg blew up), so the runner boundary maps it to `null` here rather
 * than trusting every caller to remember. `false` is thereby reserved for an
 * authoritative "still blocked" that a runner returned deliberately. verifyBlockers
 * keeps its own try/catch as belt-and-suspenders, but this makes the invariant a
 * property of the vocabulary itself: `PROBES[x].run(...)` can never reject or
 * surface a thrown error as a `false`. (The other half — a scoped read that
 * *succeeds* but comes back empty — cannot be caught generically; each runner
 * owns it for its own source, e.g. webhookRegistered returning null on missing
 * creds / missing nodes.)
 */
export function guardedRun(
  name: string,
  run: (arg: string) => Promise<ProbeVerdict>,
): (arg: string) => Promise<ProbeVerdict> {
  return async (arg: string) => {
    try {
      return await run(arg)
    } catch (err) {
      console.warn(`[owner-blockers] probe ${name}(${arg}) could not ask:`, String(err).slice(0, 200))
      return null
    }
  }
}

/**
 * The executable probes: core's phrasing paired with the runner here. Built by
 * walking PROBE_DESCRIPTIONS so a probe can never be described to the owner
 * without something able to check it, or vice versa. Every runner is wrapped in
 * guardedRun so a thrown error is reported as `null` (could not ask), never as a
 * `false` (still blocked).
 */
export const PROBES: Record<string, ProbeDef> = Object.fromEntries(
  Object.entries(PROBE_DESCRIPTIONS)
    .filter(([name]) => Object.hasOwn(RUNNERS, name))
    .map(([name, describe]) => [name, { describe, run: guardedRun(name, RUNNERS[name]!) }]),
)

/* ── Writing ───────────────────────────────────────────────────────────────── */

function clamp(s: string | null | undefined, n: number): string | null {
  if (typeof s !== 'string') return null
  const t = s.trim()
  return t ? t.slice(0, n) : null
}

export interface FileBlockerResult {
  id: number
  created: boolean
  reopened: boolean
  /**
   * An OPEN blocker whose key looks like the same condition in different
   * words. Advisory: the row was still filed. Reported so blocker-scout and
   * the owner digest can say "this may already be row #N" instead of the
   * owner discovering the pair by reading two near-identical lines.
   */
  nearDuplicateOf?: { id: number; key: string; score: number }
}

/**
 * File a blocker, or re-observe one already filed.
 *
 * Idempotent by dedupe_key, which is the whole point: the doc parser, the
 * nightly DB sweep, and the transcript miner will all independently rediscover
 * the same blocker, and the owner should see one line, aging, not three.
 *
 * A re-observation of an OPEN row bumps last_seen_at and fills in any field
 * that was previously empty, but never overwrites detail the owner may have
 * edited. A re-observation of a CLEARED row reopens it: the condition came
 * back, which is a real event worth surfacing rather than silently ignoring.
 */
export async function fileBlocker(input: BlockerInput): Promise<FileBlockerResult> {
  // Canonicalized, not just clamped: blockers 20 and 21 on 2026-08-24 were one
  // condition (migration 082 unapplied) filed twice because two agents wrote
  // the key with different word order. Canonicalization collapses cosmetic
  // differences; genuinely different wording is caught by the near-duplicate
  // warning below, which reports rather than merges.
  const dedupeKey = canonicalDedupeKey(clamp(input.dedupeKey, 160) ?? '', { maxLength: 80 })
  const title = clamp(input.title, 200)
  if (!dedupeKey) throw new Error('fileBlocker: dedupeKey required')
  if (!title) throw new Error('fileBlocker: title required')

  // A CONFIRMED-titled blocker asserts a measured fact, so it MUST name the
  // credential/app/token/path the check ran with in its evidence — otherwise a
  // credential-scoped absence gets filed as a fact about the world (#4702). The
  // authoritative guard lives here so every caller is covered (the HTTP route
  // AND blocker-scout's direct calls), and it throws before any DB write.
  const evidence = clamp(input.evidence, 4000)
  if (titleClaimsConfirmed(title) && !evidence) {
    throw new Error(
      'fileBlocker: a CONFIRMED-titled blocker requires a non-empty evidence field naming the credential, app, token, or network path the check ran with',
    )
  }

  const category = (BLOCKER_CATEGORIES as readonly string[]).includes(input.category ?? '')
    ? input.category! : 'other'

  // Derive a probe where the row already carries its own argument, then say so
  // loudly when one is still missing in a category that should have had it.
  // Reported rather than thrown on purpose: a filer that cannot supply a probe
  // must still be able to put the blocker in front of the owner, because losing
  // the row is worse than losing the probe. The warning is what makes the gap
  // visible instead of silent.
  const derived = suggestProbeFor({ ...input, category })
  if (derived) {
    input = { ...input, verifyProbe: derived.verifyProbe, verifyArg: derived.verifyArg }
  }
  const gap = probeGapReason({ category, verifyProbe: input.verifyProbe ?? null })
  if (gap) console.warn(`[owner-blockers] ${dedupeKey}: ${gap}`)
  const source = (BLOCKER_SOURCES as readonly string[]).includes(input.source ?? '')
    ? input.source! : 'agent'
  const priority = Math.min(Math.max(Math.round(Number(input.priority ?? 3)) || 3, 1), 5)
  const probe = isProbe(input.verifyProbe) ? input.verifyProbe : null

  // Read the prior status first. The upsert below cannot report it: RETURNING
  // sees post-update values, so an already-open row and a genuinely reopened
  // one are indistinguishable there.
  const priorRes = await db.execute(sql`
    SELECT status FROM owner_blockers WHERE dedupe_key = ${dedupeKey} LIMIT 1`)
  const priorRow = (priorRes.rows ?? [])[0] as Record<string, unknown> | undefined
  const priorStatus = priorRow ? String(priorRow['status'] ?? '') : null

  const res = await db.execute(sql`
    INSERT INTO owner_blockers (
      dedupe_key, title, detail, unblocks, where_to_go, category, priority,
      source, source_ref, evidence, verify_probe, verify_arg
    ) VALUES (
      ${dedupeKey}, ${title}, ${clamp(input.detail, 4000)}, ${clamp(input.unblocks, 2000)},
      ${clamp(input.whereToGo, 1000)}, ${category}, ${priority},
      ${source}, ${clamp(input.sourceRef, 500)}, ${evidence},
      ${probe}, ${clamp(input.verifyArg, 200)}
    )
    ON CONFLICT (dedupe_key) DO UPDATE SET
      last_seen_at = now(),
      updated_at   = now(),
      -- Reopen a cleared row: the condition came back.
      status       = CASE WHEN owner_blockers.status = 'cleared' THEN 'open'
                          ELSE owner_blockers.status END,
      cleared_at   = CASE WHEN owner_blockers.status = 'cleared' THEN NULL
                          ELSE owner_blockers.cleared_at END,
      cleared_by   = CASE WHEN owner_blockers.status = 'cleared' THEN NULL
                          ELSE owner_blockers.cleared_by END,
      -- Fill gaps, never clobber what is already recorded.
      detail       = COALESCE(owner_blockers.detail, EXCLUDED.detail),
      unblocks     = COALESCE(owner_blockers.unblocks, EXCLUDED.unblocks),
      where_to_go  = COALESCE(owner_blockers.where_to_go, EXCLUDED.where_to_go),
      evidence     = COALESCE(owner_blockers.evidence, EXCLUDED.evidence),
      verify_probe = COALESCE(owner_blockers.verify_probe, EXCLUDED.verify_probe),
      verify_arg   = COALESCE(owner_blockers.verify_arg, EXCLUDED.verify_arg)
    RETURNING id, (xmax = 0) AS created`)

  const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined
  const id = Number(row?.['id'] ?? 0)
  const created = row?.['created'] === true
  const near = created ? await nearDuplicateBlocker(id, dedupeKey) : undefined
  return {
    id,
    created,
    reopened: priorStatus === 'cleared',
    ...(near ? { nearDuplicateOf: near } : {}),
  }
}

/**
 * Look for an open blocker describing the same condition in different words.
 *
 * Only runs on a genuinely new row (an exact-key re-observation is already
 * handled by the upsert). Never throws and never merges: filing a blocker is
 * how the owner finds out something is stuck, and a fuzzy guess must not be
 * able to swallow that.
 */
async function nearDuplicateBlocker(
  id: number,
  dedupeKey: string,
): Promise<{ id: number; key: string; score: number } | undefined> {
  try {
    const res = await db.execute(sql`
      SELECT id, dedupe_key FROM owner_blockers
      WHERE status = 'open' AND id <> ${id} LIMIT 200`)
    const rows = (res.rows ?? []).map(r => ({
      id: Number((r as Record<string, unknown>)['id'] ?? 0),
      dedupeKey: String((r as Record<string, unknown>)['dedupe_key'] ?? '') || null,
    }))
    const hit = findNearDuplicate(dedupeKey, rows)
    if (!hit) return undefined
    console.warn(
      `[blockers] #${id} ('${dedupeKey}') looks like a duplicate of #${hit.candidate.id} `
      + `('${hit.key}', ${Math.round(hit.score * 100)}% key overlap)`,
    )
    return { id: hit.candidate.id, key: hit.key, score: hit.score }
  } catch (err) {
    console.warn(`[blockers] near-duplicate check for #${id} failed:`, String(err).slice(0, 200))
    return undefined
  }
}

export async function clearBlocker(
  id: number,
  by: 'owner' | 'auto' | 'agent',
  note?: string | null,
): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE owner_blockers
       SET status = 'cleared', cleared_at = now(), cleared_by = ${by},
           clear_note = ${clamp(note, 1000)}, updated_at = now()
     WHERE id = ${id} AND status <> 'cleared'
     RETURNING id`)
  return (res.rows ?? []).length > 0
}

export async function dismissBlocker(id: number, note?: string | null): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE owner_blockers
       SET status = 'dismissed', cleared_at = now(), cleared_by = 'owner',
           clear_note = ${clamp(note, 1000)}, updated_at = now()
     WHERE id = ${id} AND status = 'open'
     RETURNING id`)
  return (res.rows ?? []).length > 0
}

/* ── Reading ───────────────────────────────────────────────────────────────── */

function toBlocker(r: Record<string, unknown>): OwnerBlocker {
  const firstSeen = String(r['first_seen_at'] ?? '')
  return {
    id: Number(r['id'] ?? 0),
    dedupeKey: String(r['dedupe_key'] ?? ''),
    title: String(r['title'] ?? ''),
    detail: r['detail'] == null ? null : String(r['detail']),
    unblocks: r['unblocks'] == null ? null : String(r['unblocks']),
    whereToGo: r['where_to_go'] == null ? null : String(r['where_to_go']),
    category: String(r['category'] ?? 'other'),
    priority: Number(r['priority'] ?? 3),
    status: String(r['status'] ?? 'open'),
    source: String(r['source'] ?? 'agent'),
    sourceRef: r['source_ref'] == null ? null : String(r['source_ref']),
    evidence: r['evidence'] == null ? null : String(r['evidence']),
    verifyProbe: r['verify_probe'] == null ? null : String(r['verify_probe']),
    verifyArg: r['verify_arg'] == null ? null : String(r['verify_arg']),
    lastVerifiedAt: r['last_verified_at'] == null ? null : String(r['last_verified_at']),
    lastVerifyOk: r['last_verify_ok'] == null ? null : r['last_verify_ok'] === true,
    firstSeenAt: firstSeen,
    lastSeenAt: String(r['last_seen_at'] ?? ''),
    ageDays: Math.max(0, Math.round(Number(r['age_days'] ?? 0))),
  }
}

const SELECT_COLS = sql`
  id, dedupe_key, title, detail, unblocks, where_to_go, category, priority,
  status, source, source_ref, evidence, verify_probe, verify_arg,
  last_verified_at::text AS last_verified_at, last_verify_ok,
  first_seen_at::text AS first_seen_at, last_seen_at::text AS last_seen_at,
  EXTRACT(epoch FROM now() - first_seen_at)::float8 / 86400 AS age_days`

export async function listOpenBlockers(limit = 50): Promise<OwnerBlocker[]> {
  const res = await db.execute(sql`
    SELECT ${SELECT_COLS} FROM owner_blockers
     WHERE status = 'open'
     ORDER BY priority ASC, first_seen_at ASC
     LIMIT ${limit}`)
  return (res.rows ?? []).map(r => toBlocker(r as Record<string, unknown>))
}

export async function listRecentlyCleared(days = 7, limit = 20): Promise<OwnerBlocker[]> {
  const res = await db.execute(sql`
    SELECT ${SELECT_COLS} FROM owner_blockers
     WHERE status = 'cleared'
       AND cleared_at >= now() - (${String(days)} || ' days')::interval
     ORDER BY cleared_at DESC
     LIMIT ${limit}`)
  return (res.rows ?? []).map(r => toBlocker(r as Record<string, unknown>))
}

export async function listAllBlockers(limit = 200): Promise<OwnerBlocker[]> {
  const res = await db.execute(sql`
    SELECT ${SELECT_COLS} FROM owner_blockers
     ORDER BY (status = 'open') DESC, priority ASC, first_seen_at ASC
     LIMIT ${limit}`)
  return (res.rows ?? []).map(r => toBlocker(r as Record<string, unknown>))
}

/* ── Verification sweep ────────────────────────────────────────────────────── */

export interface VerifyResult {
  checked: number
  autoCleared: Array<{ id: number; title: string }>
  stillBlocked: number
  unknown: number
}

/**
 * Run every open blocker's probe and auto-clear the ones whose condition is
 * now satisfied. This is what keeps the list honest without anyone curating
 * it: the morning after Mike applies a migration or flips a valve, the row
 * closes itself and stops appearing in the email.
 *
 * A probe that errors or returns null leaves the row open. Never the reverse.
 */
export async function verifyBlockers(): Promise<VerifyResult> {
  const open = await listOpenBlockers(200)
  const out: VerifyResult = { checked: 0, autoCleared: [], stillBlocked: 0, unknown: 0 }

  for (const b of open) {
    if (!b.verifyProbe || !isProbe(b.verifyProbe)) continue
    out.checked++
    let verdict: ProbeVerdict = null
    try {
      verdict = await PROBES[b.verifyProbe]!.run(b.verifyArg ?? '')
    } catch (err) {
      console.warn(`[owner-blockers] probe ${b.verifyProbe}(${b.verifyArg}) failed:`, String(err).slice(0, 200))
      verdict = null
    }

    await db.execute(sql`
      UPDATE owner_blockers
         SET last_verified_at = now(), last_verify_ok = ${verdict}, updated_at = now()
       WHERE id = ${b.id}`)

    if (verdict === true) {
      await clearBlocker(b.id, 'auto', `probe ${b.verifyProbe}(${b.verifyArg ?? ''}) satisfied`)
      out.autoCleared.push({ id: b.id, title: b.title })
    } else if (verdict === false) {
      out.stillBlocked++
    } else {
      out.unknown++
    }
  }
  return out
}

/* ── The daily send ────────────────────────────────────────────────────────── */

export interface BlockerEmailResult {
  sent: boolean
  skipped?: string
  open?: number
  autoCleared?: number
  subject?: string
}

/**
 * Verify, then send. Order matters: probes run first so a blocker the owner
 * cleared yesterday never appears in this morning's email. Sending a list that
 * asks for something already done is the fastest way to teach someone to stop
 * reading it.
 *
 * Unlike the digest, this sends even when the list is empty. "Nothing is
 * waiting on you today" is information, and its absence would make silence
 * ambiguous: no email could mean nothing to do, or could mean the cron died.
 */
export async function runBlockerEmail(opts: { force?: boolean } = {}): Promise<BlockerEmailResult> {
  const { sendOwnerEmail } = await import('~/lib/owner-alerts.server')
  const { kvSetNX, kvDel } = await import('~/lib/kv.server')

  // Read the valve straight from pipeline_settings rather than through
  // getValve(), whose key type is the fixed VALVE_KEYS union. Fail OPEN: if the
  // settings read errors we still send, because the failure mode of this
  // particular email is "the owner never learns he is blocking something".
  if (!opts.force) {
    const off = await settingIs('blocker_email_enabled', 'false').catch(() => false)
    if (off === true) return { sent: false, skipped: 'blocker_email_enabled is off' }
  }

  const day = new Date().toISOString().slice(0, 10)
  if (!opts.force) {
    const first = await kvSetNX(`blocker-email:sent:${day}`, String(Date.now()), 26 * 3600)
    if (!first) return { sent: false, skipped: 'already sent today (pass force=1 to re-send)' }
  }

  const verified = await verifyBlockers()
  const open = await listOpenBlockers()
  const cleared = await listRecentlyCleared()
  const baseUrl = process.env['BASE_URL'] ?? 'https://xdipx.com'

  const subject = blockerEmailSubject(open)
  const html = renderBlockerEmail(open, cleared, baseUrl)
  const res = await sendOwnerEmail(subject, html, { fromName: 'xdipx blockers' })

  if (res.sent) {
    return { sent: true, subject, open: open.length, autoCleared: verified.autoCleared.length }
  }

  // Give the day slot back and fail loudly, same contract as the digest: a
  // list that silently did not send is the exact failure class it exists to catch.
  if (!opts.force) await kvDel(`blocker-email:sent:${day}`)
  throw new Error(`blocker email send failed: ${res.error ?? 'unknown error'}`)
}
