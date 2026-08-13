/**
 * Coverage audit: which automation would fail without anyone noticing.
 *
 * The blocker list catches problems that were already noticed by someone. This
 * catches the class before that: a lane with no watcher at all. The store has
 * roughly twenty scheduled routines and the wiring that proves each one is
 * alive is spread across four hand-maintained places that nothing compares:
 *
 *   - `docs/store-team/routine-schedule.md`  — the manifest of what should run
 *   - `ROUTINE_CADENCES` in ticket-janitor   — what the liveness check watches
 *   - `vercel.json` crons                    — the server-side schedules
 *   - `server/cron.ts`                       — the routes those schedules hit
 *
 * ROUTINE_CADENCES literally carries the comment "if the manifest and this
 * table disagree, fix one of them in the same PR". Nothing enforced it, so a
 * routine could be added to the manifest, given a trigger, and run for months
 * with its silent death undetectable, because the liveness check only knows
 * about lanes someone remembered to add twice.
 *
 * Everything here is pure: parsers take file text, auditors take parsed input
 * and return findings. The IO (reading files, querying the DB, filing tickets
 * and blockers) lives in scripts/coverage-audit.ts. That split keeps the
 * judgment testable and means this never has to run on Vercel, where the docs
 * directory is not in the deployed bundle.
 */

/* ── Findings ──────────────────────────────────────────────────────────────── */

export type FindingRoute = 'ticket' | 'blocker'
export type FindingSeverity = 'high' | 'medium' | 'low'

export interface CoverageFinding {
  /** Stable dedupe key, so re-running files nothing new. */
  key: string
  severity: FindingSeverity
  /** What is uncovered, as a statement. */
  title: string
  /** Why it matters: the failure that would go unnoticed. */
  detail: string
  /** The concrete fix. */
  remedy: string
  /**
   * Where this goes. The blocker/ticket line from the blocker list applies
   * unchanged: 'blocker' means no agent can do it (a scheduler trigger, a prod
   * settings row), 'ticket' means an agent can.
   */
  route: FindingRoute
  check: string
}

/* ── Parsers ───────────────────────────────────────────────────────────────── */

/** `cronRoute('/foo', ...)` occurrences in server/cron.ts, as '/cron/foo'. */
export function parseCronRoutes(source: string): string[] {
  const out = new Set<string>()
  for (const m of source.matchAll(/cronRoute\(\s*['"`](\/[^'"`]+)['"`]/g)) {
    out.add(`/cron${m[1]}`)
  }
  return [...out].sort()
}

export interface VercelCron {
  path: string
  schedule: string
}

/** The `crons` array from vercel.json. Tolerates a missing or malformed key. */
export function parseVercelCrons(json: string): VercelCron[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  const crons = (parsed as Record<string, unknown>)?.['crons']
  if (!Array.isArray(crons)) return []
  return crons
    .map(c => {
      const row = c as Record<string, unknown>
      return { path: String(row['path'] ?? ''), schedule: String(row['schedule'] ?? '') }
    })
    .filter(c => c.path)
}

/**
 * Playbook cells are not always a bare path: row 22 reads "this table plus
 * `docs/store-team/operating-system.md` §...". Take the first path-shaped
 * token, and return null when the cell cites no file at all.
 */
export function extractPath(cell: string): string | null {
  const m = cell.match(/(?:docs|app|scripts|server|db|\.claude)\/[A-Za-z0-9._/-]+/)
  return m ? m[0].replace(/[.,;]+$/, '') : null
}

export interface ManifestRoutine {
  num: string
  name: string
  cron: string
  team: string
  /** The manifest says this routine deliberately opens no run row. */
  writesNoRunRows: boolean
  playbook: string
}

/**
 * The "The routines" table of routine-schedule.md:
 *   | # | Name | Cron (UTC) | Team / feature label | Playbook | Extra clauses |
 *
 * Only the first five cells are read, so a pipe inside the prose column cannot
 * shift anything that matters. Rows whose first cell is not a number are
 * skipped, which drops the header and separator without needing to find them.
 */
export function parseManifestRoutines(md: string): ManifestRoutine[] {
  const out: ManifestRoutine[] = []
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1).map(c => c.trim())
    if (cells.length < 5) continue
    const num = cells[0] ?? ''
    if (!/^\d+$/.test(num)) continue
    // The trigger table shares the numbered-row shape but has only 3 columns;
    // requiring a playbook-looking 5th cell keeps the two tables apart.
    const playbook = stripCode(cells[4] ?? '')
    if (!playbook.includes('/')) continue
    // The team cell reads "none — starts no run row ..." for routines that
    // deliberately write none; carry that through, since run-row liveness is
    // structurally impossible for them.
    const team = stripCode(cells[3] ?? '')
    out.push({
      num,
      name: cells[1] ?? '',
      cron: stripCode(cells[2] ?? ''),
      team,
      writesNoRunRows: /^none\b/i.test(team),
      playbook,
    })
  }
  return out
}

/**
 * ROUTINE_CADENCES entries, read out of the ticket-janitor source text rather
 * than imported. Importing it would pull in db.server and require a live
 * DATABASE_URL, which would make the entire static half of this audit
 * unrunnable without a database. The entries are one uniform line each.
 *
 * Callers must treat an empty result as a parse failure, never as "nothing is
 * watched": silently reporting every routine as uncovered would be worse than
 * not running.
 */
export function parseCadences(source: string): CadenceLike[] {
  const out: CadenceLike[] = []
  const re = /\{\s*routine:\s*'([^']+)',\s*team:\s*(?:'([^']+)'|null)\s*,\s*runType:\s*'([^']+)'/g
  for (const m of source.matchAll(re)) {
    out.push({ routine: m[1]!, team: m[2] ?? null, runType: m[3]! })
  }
  return out
}

export interface ManifestTrigger {
  num: string
  name: string
  /** Raw trigger cell. 'none' (case-insensitive prefix) means unscheduled. */
  trigger: string
  hasTrigger: boolean
  /** The doc explicitly annotates deliberate gaps as "expected-missing". */
  expectedMissing: boolean
}

/** The `| # | Name | Trigger ID |` table. */
export function parseManifestTriggers(md: string): ManifestTrigger[] {
  const out: ManifestTrigger[] = []
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1).map(c => c.trim())
    if (cells.length < 3) continue
    const num = cells[0] ?? ''
    if (!/^\d+$/.test(num)) continue
    const trigger = cells[2] ?? ''
    // A 5-column routines row would also pass the checks above; the trigger
    // table's third cell is a trig_ id or 'none', never a cron expression.
    const looksLikeTrigger = /trig_|^none\b/i.test(trigger)
    if (!looksLikeTrigger) continue
    out.push({
      num,
      name: cells[1] ?? '',
      trigger,
      hasTrigger: /trig_/.test(trigger),
      expectedMissing: /expected[- ]missing/i.test(trigger),
    })
  }
  return out
}

function stripCode(s: string): string {
  return s.replace(/`/g, '').trim()
}

/* ── Name matching ─────────────────────────────────────────────────────────── */

/**
 * Routine names are written differently in each place: the manifest says
 * "xdipx — Daily Dev (R-DEV)", ROUTINE_CADENCES says "R-DEV daily dev". Exact
 * or substring matching fails on exactly those two, so compare token sets and
 * treat a subset either way as a match.
 */
export function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/xdipx/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 0),
  )
}

export function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  if (ta.size === 0 || tb.size === 0) return false
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta]
  // Two shared tokens is the floor; one ("weekly", "daily") matches everything.
  if (small.size < 2) return false
  for (const t of small) if (!large.has(t)) return false
  return true
}

/* ── Auditors ──────────────────────────────────────────────────────────────── */

/** Minimal shape of a ROUTINE_CADENCES entry, so this module imports nothing. */
export interface CadenceLike {
  routine: string
  team: string | null
  runType: string
}

/**
 * The headline check. A routine in the manifest with a live trigger, but no
 * entry in ROUTINE_CADENCES, is a lane whose silent death nothing detects: the
 * liveness check in ticket-janitor only flags routines it has been told about,
 * so an unlisted lane can stop running forever without a single alert.
 */
export function auditRoutineCoverage(
  manifest: readonly ManifestRoutine[],
  triggers: readonly ManifestTrigger[],
  cadences: readonly CadenceLike[],
): CoverageFinding[] {
  const out: CoverageFinding[] = []
  for (const r of manifest) {
    const trig = triggers.find(t => t.num === r.num || namesMatch(t.name, r.name))
    // A routine with no trigger is a different finding (auditTriggerCoverage);
    // not being watched is only interesting for something meant to be running.
    if (trig && !trig.hasTrigger) continue

    if (cadences.some(c => namesMatch(c.routine, r.name))) continue

    // A routine that deliberately opens no run row cannot be watched by the
    // run-row liveness check at all, so "add a cadence entry" is the wrong
    // remedy. The coverage hole is real either way, but it needs a different
    // mechanism, and saying so beats filing a ticket that cannot be done.
    if (r.writesNoRunRows) {
      out.push({
        key: `coverage:unwatchable:${slug(r.name)}`,
        severity: 'medium',
        title: `Routine "${cleanName(r.name)}" cannot be watched by the liveness check`,
        detail:
          `Manifest row ${r.num} records that it deliberately opens no run row and consumes no team's run cap. ` +
          `That is a defensible design, but it means the run-row liveness check is structurally blind to it: if ` +
          `this routine silently stops firing, nothing in the store detects it, and the digest stays green.`,
        remedy:
          `Give it a heartbeat the liveness check can see. Either have it post a lightweight event on each run ` +
          `and extend checkRoutineLiveness to accept event rows as well as run rows, or accept the gap ` +
          `explicitly by annotating the manifest row so this audit stops asking.`,
        route: 'ticket',
        check: 'unwatchable-routine',
      })
      continue
    }

    out.push({
      key: `coverage:liveness:${slug(r.name)}`,
      severity: 'high',
      title: `Routine "${cleanName(r.name)}" has no liveness entry`,
      detail:
        `It is in the schedule manifest (row ${r.num}, cron ${r.cron || 'unstated'}) and is expected to be running, ` +
        `but ROUTINE_CADENCES in app/lib/ticket-janitor.server.ts has no entry for it. The liveness check only ` +
        `flags routines listed there, so if this one stops firing, nothing detects it and nothing reaches the ` +
        `owner digest or the blocker list. It would go unnoticed indefinitely.`,
      remedy:
        `Add a RoutineCadence row for it in app/lib/ticket-janitor.server.ts with the team, runType, schedule, ` +
        `and an appropriate maxGapHours. Confirm the runType matches what the playbook actually opens its run ` +
        `with, otherwise the entry watches a lane that never writes rows.`,
      route: 'ticket',
      check: 'routine-coverage',
    })
  }
  return out
}

/**
 * A manifest routine with no trigger at all. Deliberate gaps are annotated
 * "expected-missing" in the doc and are skipped, so what is left is a routine
 * the manifest says should run and the scheduler never fires.
 */
export function auditTriggerCoverage(triggers: readonly ManifestTrigger[]): CoverageFinding[] {
  const out: CoverageFinding[] = []
  for (const t of triggers) {
    if (t.hasTrigger || t.expectedMissing) continue
    out.push({
      key: `coverage:trigger:${slug(t.name)}`,
      severity: 'high',
      title: `Routine "${cleanName(t.name)}" has no scheduler trigger`,
      detail:
        `Manifest row ${t.num} lists no trigger id and is not annotated expected-missing, so the manifest says ` +
        `this should be running and nothing fires it. This is the live-but-dead shape that hid the trend-scout ` +
        `lanes for eleven days: the valve was on, so every dashboard read as healthy.`,
      remedy:
        `Create the trigger in the Claude scheduler and record its id in the manifest table, or annotate the row ` +
        `expected-missing with the reason if the gap is deliberate.`,
      // Only the owner can touch the cloud scheduler.
      route: 'blocker',
      check: 'trigger-coverage',
    })
  }
  return out
}

/**
 * Cron routes that never fire, and schedules that hit nothing.
 *
 * `invokedInCode` carries the paths something else calls directly, e.g.
 * /cron/warm-homepage, which homepage-payload.server.ts fires on demand. Those
 * are on-demand endpoints that happen to live under /cron, not missed
 * schedules, and flagging them would be noise that trains you to skim.
 */
export function auditCronParity(
  routes: readonly string[],
  crons: readonly VercelCron[],
  invokedInCode: ReadonlySet<string> = new Set(),
): CoverageFinding[] {
  const out: CoverageFinding[] = []
  const scheduled = new Set(crons.map(c => c.path))
  const defined = new Set(routes)

  for (const r of routes) {
    if (scheduled.has(r) || invokedInCode.has(r)) continue
    out.push({
      key: `coverage:cron-unscheduled:${slug(r)}`,
      severity: 'medium',
      title: `Cron route ${r} has no schedule and no caller`,
      detail:
        `The route is registered in server/cron.ts, vercel.json has no crons entry for it, and nothing else in ` +
        `the repo calls it. It only runs if someone hits it by hand, so whatever it does is not happening.`,
      remedy:
        `Add a crons entry in vercel.json, or delete the route if it is genuinely obsolete. Note vercel.json is a ` +
        `protected path, so the PR will stop for the owner rather than auto-merging.`,
      route: 'ticket',
      check: 'cron-parity',
    })
  }

  for (const c of crons) {
    if (!c.path.startsWith('/cron/') || defined.has(c.path)) continue
    out.push({
      key: `coverage:cron-orphan:${slug(c.path)}`,
      severity: 'high',
      title: `Schedule ${c.path} hits no route`,
      detail:
        `vercel.json schedules ${c.path} (${c.schedule}) but server/cron.ts registers no such route, so this ` +
        `fires into a 404 on every tick and reports nothing.`,
      remedy: `Register the route in server/cron.ts, or remove the stale crons entry from vercel.json.`,
      route: 'ticket',
      check: 'cron-parity',
    })
  }
  return out
}

/** Manifest rows pointing at a playbook that is not on disk. */
export function auditPlaybooks(
  manifest: readonly ManifestRoutine[],
  existingPaths: ReadonlySet<string>,
): CoverageFinding[] {
  const out: CoverageFinding[] = []
  for (const r of manifest) {
    // Some rows cite an agent def instead of a playbook, and some wrap the
    // path in prose; both are handled by extractPath. A row citing no file at
    // all is not a broken reference, so it is skipped rather than flagged.
    const path = extractPath(r.playbook)
    if (!path || existingPaths.has(path)) continue
    out.push({
      key: `coverage:playbook:${slug(path)}`,
      severity: 'medium',
      title: `Routine "${cleanName(r.name)}" cites a playbook that does not exist`,
      detail:
        `Manifest row ${r.num} points at ${path}, which is not in the repo. The scheduled prompt tells the agent ` +
        `to read that file, so the routine runs without the instructions it is supposed to follow.`,
      remedy: `Fix the path in docs/store-team/routine-schedule.md, or restore the missing playbook.`,
      route: 'ticket',
      check: 'playbook-paths',
    })
  }
  return out
}

/**
 * Lanes that are demonstrably running (they wrote run rows) but appear in no
 * cadence entry. Complements auditRoutineCoverage from the other direction:
 * that one trusts the manifest, this one trusts reality.
 */
export function auditObservedLanes(
  observed: ReadonlyArray<{ team: string | null; runType: string; runs: number }>,
  cadences: readonly CadenceLike[],
): CoverageFinding[] {
  const out: CoverageFinding[] = []
  for (const o of observed) {
    // 'manual' is the shared bucket several playbooks open with; a cadence
    // entry already rides it and per-lane attribution is impossible here.
    if (o.runType === 'manual') continue
    if (cadences.some(c => c.runType === o.runType && (c.team === null || c.team === o.team))) continue
    out.push({
      key: `coverage:lane:${slug(`${o.team ?? 'none'}-${o.runType}`)}`,
      severity: 'medium',
      title: `Lane ${o.team ?? 'no team'}/${o.runType} runs but is not watched`,
      detail:
        `It wrote ${o.runs} run row${o.runs === 1 ? '' : 's'} recently, so it is a real active lane, but no ` +
        `ROUTINE_CADENCES entry matches its team and runType. If it stops, the liveness check will not notice.`,
      remedy:
        `Add a cadence entry for it, or if the runType is a typo of an existing lane, fix the playbook so both ` +
        `agree. A cadence entry watching a runType nothing writes is permanently red and gets ignored.`,
      route: 'ticket',
      check: 'observed-lanes',
    })
  }
  return out
}

/**
 * Enabled teams whose run-cap or budget row is missing from pipeline_settings.
 *
 * Deliberately narrower than "every key the code reads". An absent VALVE row
 * reads as false, which is the safe default and usually the intent, so
 * flagging those would bury the real finding in noise. An absent CAP on a team
 * that is switched on is different: the team runs against a conservative
 * built-in default, and the symptom is runs silently skipping `over_run_cap`
 * rather than any error. That is exactly what happened to `social_team_max_runs`,
 * which sat unset and defaulting to 2 while the manifest said it required 3,
 * so Monday social runs skipped and every dashboard read as healthy.
 */
export function auditTeamCaps(
  enabledTeams: readonly string[],
  present: ReadonlySet<string>,
): CoverageFinding[] {
  const out: CoverageFinding[] = []
  for (const team of [...enabledTeams].sort()) {
    for (const suffix of ['max_runs', 'daily_cents'] as const) {
      const key = `${team}_team_${suffix}`
      if (present.has(key)) continue
      out.push({
        key: `coverage:setting:${slug(key)}`,
        severity: 'medium',
        title: `${team} is enabled but ${key} has no row`,
        detail:
          `The team is switched on and running against the built-in default rather than a value anyone chose. ` +
          `Nothing errors when this is wrong: a run over the default cap just skips with over_run_cap, which ` +
          `reads as a normal outcome everywhere. This is how the social lane lost its Monday runs.`,
        remedy:
          `Insert the row in production with the value the schedule manifest requires (see the Run-cap ` +
          `requirements table in docs/store-team/routine-schedule.md), or confirm the default is genuinely right.`,
        // A production settings write is not something an agent does.
        route: 'blocker',
        check: 'team-caps',
      })
    }
  }
  return out
}

/**
 * How much of the blocker list can close itself. Informational, and reported
 * as one finding rather than one per row so it never crowds the list it is
 * measuring.
 */
export function auditProbeCoverage(
  openBlockers: ReadonlyArray<{ verifyProbe: string | null }>,
  threshold = 0.5,
): CoverageFinding[] {
  const total = openBlockers.length
  if (total === 0) return []
  const withProbe = openBlockers.filter(b => b.verifyProbe).length
  const ratio = withProbe / total
  if (ratio >= threshold) return []
  return [{
    key: 'coverage:probe-ratio',
    severity: 'low',
    title: `Only ${withProbe} of ${total} open blockers can close themselves`,
    detail:
      `The rest need someone to remember to mark them done, which is the hand-curation that turned the previous ` +
      `blocker doc into something nobody trusted. A list that mostly cannot self-close drifts out of date and ` +
      `then gets ignored wholesale.`,
    remedy:
      `Give the probe-less rows a verifyProbe where a check exists, or extend the probe vocabulary in ` +
      `app/lib/owner-blockers-core.ts if a whole class of blocker has no way to be checked.`,
    route: 'ticket',
    check: 'probe-coverage',
  }]
}

/* ── Summary ───────────────────────────────────────────────────────────────── */

export interface CoverageSummary {
  total: number
  high: number
  medium: number
  low: number
  tickets: number
  blockers: number
  byCheck: Record<string, number>
}

export function summarize(findings: readonly CoverageFinding[]): CoverageSummary {
  const byCheck: Record<string, number> = {}
  for (const f of findings) byCheck[f.check] = (byCheck[f.check] ?? 0) + 1
  return {
    total: findings.length,
    high: findings.filter(f => f.severity === 'high').length,
    medium: findings.filter(f => f.severity === 'medium').length,
    low: findings.filter(f => f.severity === 'low').length,
    tickets: findings.filter(f => f.route === 'ticket').length,
    blockers: findings.filter(f => f.route === 'blocker').length,
    byCheck,
  }
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2 }

export function sortFindings(findings: readonly CoverageFinding[]): CoverageFinding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.key.localeCompare(b.key),
  )
}

/** Plain-text report for the routine's run summary and the console. */
export function renderReport(findings: readonly CoverageFinding[]): string {
  const s = summarize(findings)
  if (s.total === 0) {
    return 'Coverage audit: no gaps found. Every manifest routine is watched, every cron route is scheduled, every scheduled path resolves.'
  }
  const lines = [
    `Coverage audit: ${s.total} gap${s.total === 1 ? '' : 's'} ` +
    `(${s.high} high, ${s.medium} medium, ${s.low} low) — ${s.tickets} to the bus, ${s.blockers} to the owner.`,
    '',
  ]
  for (const f of sortFindings(findings)) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.title}`)
    lines.push(`  ${f.detail}`)
    lines.push(`  Fix: ${f.remedy}`)
    lines.push(`  -> ${f.route} (${f.key})`)
    lines.push('')
  }
  return lines.join('\n')
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/xdipx/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** Manifest names carry an "xdipx — " prefix that reads as noise in a finding. */
function cleanName(s: string): string {
  return s.replace(/^xdipx\s*[—–-]\s*/i, '').trim()
}
