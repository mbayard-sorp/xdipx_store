/**
 * format-audience-csv.ts
 *
 * Builds a reviewable CSV that diffs the v2.2 audience proposal against the
 * current state in Shopify. Combines:
 *   - audience-proposal-briefs.json  (deterministic results + current state)
 *   - audience-proposals.json        (subagent output, optional)
 *
 * For each product, final tags = deterministic ∪ Claude (deduped, sorted).
 * Cleanup values (`him`, `her`, `lgbtq`, `first-time`, `gift-idea`, `us`) are
 * stripped from the current state when computing dropped/added/kept diffs.
 *
 * Also writes a distribution audit and a sparsity-floor compliance check
 * against active-only counts (per v2.2 §4.1).
 *
 * Output:
 *   audience-proposals-final.csv        (review-ready spreadsheet)
 *   audience-distribution-audit.json    (machine-readable counts)
 *
 * Usage:
 *   npx tsx scripts/format-audience-csv.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { SPEC_LIFE_EVENT_TAGS, SPEC_CLEANUP_VALUES } from './_audience-rules'

interface Brief {
  id:              string
  handle:          string
  adminUrl:        string
  title:           string
  status:          string
  productType:     string | null
  vendor:          string | null
  currentAudience: string[]
  deterministic: {
    finalAudience: string[]
    hits:          Array<{ id: string; addsTags: string[]; note: string }>
    cleanupHits:   Array<{ id: string; addsTags: string[]; note: string }>
  }
}

interface ClaudeProposal {
  id:               string
  relationshipTags: string[]
  lifeEventTags?:   string[]
  lgbtqTags?:       string[]
  rationale:        string
}

const cwd = process.cwd()
const briefsPath    = path.join(cwd, 'audience-proposal-briefs.json')
const proposalsPath = path.join(cwd, 'audience-proposals.json')
const csvOut        = path.join(cwd, 'audience-proposals-final.csv')
const auditOut      = path.join(cwd, 'audience-distribution-audit.json')

if (!fs.existsSync(briefsPath)) {
  console.error(`ERROR: ${briefsPath} not found. Run build-audience-briefs.ts first.`)
  process.exit(1)
}

const briefs = (JSON.parse(fs.readFileSync(briefsPath, 'utf8')) as { briefs: Brief[] }).briefs
const claudeMap = new Map<string, ClaudeProposal>()
if (fs.existsSync(proposalsPath)) {
  const data = JSON.parse(fs.readFileSync(proposalsPath, 'utf8')) as { proposals: ClaudeProposal[] }
  for (const p of data.proposals) claudeMap.set(p.id, p)
  console.error(`Loaded ${data.proposals.length} Claude proposals from ${path.basename(proposalsPath)}`)
} else {
  console.error(`No ${path.basename(proposalsPath)} found — CSV will reflect deterministic results only.`)
}

const SPARSITY_FLOOR = 40
const REPRESENTATION_OVERRIDE = new Set(['non-binary','gay-couples','sapphic'])

function csvCell(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)].sort()
}

function stripCleanup(xs: string[]): string[] {
  return xs.filter(x => !SPEC_CLEANUP_VALUES.has(x))
}

const header = [
  'handle','title','admin_url','status','product_type','vendor',
  'current_audience','final_audience','dropped','added','kept',
  'rule_ids','source','rationale',
].map(csvCell).join(',')

const rows: string[] = [header]
const finalCounts: Map<string, number> = new Map()
const finalCountsActive: Map<string, number> = new Map()
const finalCountsDraft: Map<string, number> = new Map()
let activeTotal = 0
let draftTotal  = 0
let coveredByClaude = 0
let coveredByDeterministic = 0
let coveredByBoth = 0
let uncovered = 0

for (const b of briefs) {
  const det     = b.deterministic.finalAudience
  const claude  = claudeMap.get(b.id)
  const claudeTags = claude
    ? [
        ...(claude.relationshipTags ?? []),
        ...(claude.lifeEventTags    ?? []),
        ...(claude.lgbtqTags        ?? []),
      ].map(t => t.replace(/^for:/, ''))
    : []

  const final = dedupe([...det, ...claudeTags])
  const currentStripped = stripCleanup(b.currentAudience)

  const dropped = b.currentAudience.filter(t => !final.includes(t))
  const added   = final.filter(t => !b.currentAudience.includes(t))
  const kept    = currentStripped.filter(t => final.includes(t))

  const sources: string[] = []
  if (det.length > 0)        sources.push('deterministic')
  if (claudeTags.length > 0) sources.push('claude')
  if (sources.length === 0) {
    sources.push('NONE')
    uncovered += 1
  } else if (sources.length === 2) {
    coveredByBoth += 1
  } else if (det.length > 0) {
    coveredByDeterministic += 1
  } else {
    coveredByClaude += 1
  }

  const ruleIds = b.deterministic.hits.map(h => h.id).join('|')

  // Track distribution
  if (b.status === 'ACTIVE') activeTotal += 1
  if (b.status === 'DRAFT')  draftTotal  += 1
  for (const t of final) {
    finalCounts.set(t, (finalCounts.get(t) ?? 0) + 1)
    if (b.status === 'ACTIVE') finalCountsActive.set(t, (finalCountsActive.get(t) ?? 0) + 1)
    if (b.status === 'DRAFT')  finalCountsDraft.set(t,  (finalCountsDraft.get(t)  ?? 0) + 1)
  }

  rows.push([
    b.handle, b.title, b.adminUrl, b.status,
    b.productType ?? '', b.vendor ?? '',
    b.currentAudience.join('|'), final.join('|'),
    dropped.join('|'), added.join('|'), kept.join('|'),
    ruleIds, sources.join('+'),
    claude?.rationale ?? b.deterministic.hits.map(h => h.note).join(' / '),
  ].map(csvCell).join(','))
}

fs.writeFileSync(csvOut, rows.join('\n') + '\n')

// ── Distribution audit ─────────────────────────────────────────────────
const total = briefs.length

process.stderr.write(`\n────────────────────────────────────────────────────\n`)
process.stderr.write(`  Audience proposal CSV written\n`)
process.stderr.write(`────────────────────────────────────────────────────\n`)
process.stderr.write(`  Total briefs:                ${total}\n`)
process.stderr.write(`    active:                    ${activeTotal}\n`)
process.stderr.write(`    draft:                     ${draftTotal}\n`)
process.stderr.write(`  Covered (deterministic):     ${coveredByDeterministic}\n`)
process.stderr.write(`  Covered (claude):            ${coveredByClaude}\n`)
process.stderr.write(`  Covered (both):              ${coveredByBoth}\n`)
process.stderr.write(`  Uncovered (no tags):         ${uncovered}\n`)
process.stderr.write(`  Output CSV:                  ${csvOut}\n\n`)

const groupOrder: Array<[string, Set<string>]> = [
  ['Relationship', new Set(['solo','couples','long-distance'])],
  ['LGBTQ',        new Set(['queer-friendly','gay-couples','sapphic','non-binary'])],
  ['Life-event',   SPEC_LIFE_EVENT_TAGS],
]

for (const [label, set] of groupOrder) {
  process.stderr.write(`  ${label} distribution (% of all ${total} briefs · active-only count):\n`)
  const tags = [...set].sort()
  for (const t of tags) {
    const all    = finalCounts.get(t) ?? 0
    const active = finalCountsActive.get(t) ?? 0
    const pct    = total > 0 ? ((all / total) * 100).toFixed(1) : '0.0'
    const flags: string[] = []
    if (active < SPARSITY_FLOOR) {
      if (REPRESENTATION_OVERRIDE.has(t)) flags.push(`⚠ <${SPARSITY_FLOOR} active · override-eligible`)
      else                                 flags.push(`✗ <${SPARSITY_FLOOR} active · CONTENT COLLECTION`)
    }
    if (active / Math.max(1, activeTotal) > 0.30) flags.push(`⚠ >30% saturation`)
    process.stderr.write(`    ${t.padEnd(18)} ${String(all).padStart(5)}  ${pct}%   active=${String(active).padStart(4)}  ${flags.join(' · ')}\n`)
  }
  process.stderr.write(`\n`)
}

// ── Sparsity floor compliance summary ──────────────────────────────────
const failedFloor: string[] = []
const overrideFloor: string[] = []
const passedFloor: string[] = []
for (const [, set] of groupOrder) {
  for (const t of set) {
    const active = finalCountsActive.get(t) ?? 0
    if (active >= SPARSITY_FLOOR) passedFloor.push(`${t} (${active})`)
    else if (REPRESENTATION_OVERRIDE.has(t)) overrideFloor.push(`${t} (${active})`)
    else failedFloor.push(`${t} (${active})`)
  }
}

process.stderr.write(`  Sparsity-floor compliance (active count, floor = ${SPARSITY_FLOOR}):\n`)
process.stderr.write(`    ✓ pass:    ${passedFloor.join(', ') || '(none)'}\n`)
process.stderr.write(`    ⚠ override: ${overrideFloor.join(', ') || '(none)'}\n`)
process.stderr.write(`    ✗ collect: ${failedFloor.join(', ') || '(none)'}\n\n`)

// ── Audit JSON ─────────────────────────────────────────────────────────
const audit = {
  generatedAt: new Date().toISOString(),
  totals: { all: total, active: activeTotal, draft: draftTotal,
            coveredByDeterministic, coveredByClaude, coveredByBoth, uncovered },
  distribution: {
    all:    Object.fromEntries(finalCounts),
    active: Object.fromEntries(finalCountsActive),
    draft:  Object.fromEntries(finalCountsDraft),
  },
  sparsityFloor: {
    floor: SPARSITY_FLOOR,
    passed:   passedFloor,
    override: overrideFloor,
    failed:   failedFloor,
  },
}
fs.writeFileSync(auditOut, JSON.stringify(audit, null, 2))
process.stderr.write(`  Audit JSON: ${auditOut}\n`)
