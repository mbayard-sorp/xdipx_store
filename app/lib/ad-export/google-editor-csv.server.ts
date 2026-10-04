/**
 * Google Ads Editor import file for Responsive Search Ads (and the Microsoft
 * Advertising Editor variant), built from one or more google or microsoft ideas.
 *
 * ENCODING DECISION (docs/audits/ad-platform-research-2026-10-03.md B.2):
 * Google's own documentation says Editor imports a CSV saved as Unicode, "UTF-16
 * on Mac via UTF-16 Unicode Text". That save format is TAB-delimited (Google's
 * own UTF-16 report downloads are tab-delimited too, see the metrics fixture),
 * and Editor detects the delimiter. So the Google file is UTF-16LE with a BOM,
 * TAB-delimited, English headers, and a .csv extension. Tabs also mean RSA text
 * like "Silicone, Glass, Steel" needs no quoting. Multiple values inside one cell
 * would use semicolons; this file never needs them (one value per cell).
 *
 * Microsoft Advertising Editor accepts Google-format headers on import, but its
 * native bulk layout is different (a Type column, Headlines and Descriptions as
 * JSON in one cell each, "Format Version" row). The microsoft lane produces that
 * native layout, UTF-8 with a BOM, comma-delimited, per
 * learn.microsoft.com/advertising/bulk-service/responsive-search-ad (read
 * 2026-10-03). Both files say Paused on every row; the owner flips them live in
 * the Editor after posting.
 *
 * Header spellings drift per account. The research doc's standing advice stands:
 * export one existing campaign from the Editor and diff the header row against
 * this file before the first real import (owner runbook step 1).
 */
import { ALL_NEGATIVES, AD_GROUP_PLANS, type AdGroupPlan, COPY_THEMES, adGroupForIdea, parseKeyword, themeForIdea, type PlannedKeyword } from './google-bank'
import { ExportRefusal, clip, fileSlug, utmContentFor, withUtms, type ExportBuild, type ExportCreative, type ExportIdea } from './common'
import { RSA_DESCRIPTIONS_MAX, RSA_DESCRIPTION_MAX, RSA_HEADLINES_MAX, RSA_HEADLINE_MAX, RSA_PATH_MAX, glyphIn, googleTextIssues } from './policy'

export type SearchVariant = 'google' | 'microsoft'

type Row = Record<string, string>
interface Table { columns: string[]; rows: Row[] }

const SITE = 'https://xdipx.com'
const HEADLINE_COLS = Array.from({ length: RSA_HEADLINES_MAX }, (_, i) => `Headline ${i + 1}`)
const DESCRIPTION_COLS = Array.from({ length: RSA_DESCRIPTIONS_MAX }, (_, i) => `Description ${i + 1}`)

export const GOOGLE_COLUMNS: readonly string[] = [
  'Campaign', 'Campaign Type', 'Networks', 'Languages', 'Budget', 'Budget type', 'Bid Strategy Type', 'Campaign Status',
  'Location',
  'Ad Group', 'Ad Group Type', 'Max CPC', 'Ad Group Status',
  'Keyword', 'Criterion Type',
  'Ad type', ...HEADLINE_COLS, ...DESCRIPTION_COLS, 'Path 1', 'Path 2', 'Final URL',
  'Status',
]

export const MICROSOFT_COLUMNS: readonly string[] = [
  'Type', 'Status', 'Id', 'Parent Id', 'Campaign', 'Ad Group', 'Name',
  'Campaign Type', 'Budget', 'Budget Type', 'Bid Strategy Type', 'Language', 'Time Zone',
  'Search Bid', 'Keyword', 'Match Type', 'Bid',
  'Final Url', 'Path 1', 'Path 2', 'Headline', 'Description',
]

// ---------------------------------------------------------------------------
// Assemble one ad group's text
// ---------------------------------------------------------------------------

export interface SearchAdGroup {
  idea: ExportIdea
  campaign: string
  adGroup: string
  keywords: PlannedKeyword[]
  maxCpcUsd: number
  headlines: string[]
  descriptions: string[]
  path1: string
  path2: string
  finalUrl: string
  utmContent: string
  padded: { headlines: number; descriptions: number }
}

function dedupe(lines: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const l of lines) {
    const t = l.trim().replace(/\s+/g, ' ')
    const k = t.toLowerCase()
    if (!t || seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

function campaignNameFor(ideas: readonly ExportIdea[], now: Date): string {
  for (const i of ideas) {
    const c = i.audience?.['campaign']
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 80)
  }
  return `xdipx-search-${now.toISOString().slice(0, 7)}`
}

export function assembleAdGroup(
  idea: ExportIdea,
  opts: { creativeId?: number | null; campaign: string; dailyCapCents: number },
): SearchAdGroup {
  const text = [idea.title, ...idea.headlines, ...idea.body].join(' ')
  const theme = COPY_THEMES[themeForIdea({ audienceTheme: idea.audience?.['theme'], text })]

  // Keywords: explicit audience.keywords, else the launch-plan ad group the idea belongs to.
  let keywords: PlannedKeyword[] = []
  const explicit = idea.audience?.['keywords']
  if (Array.isArray(explicit)) {
    keywords = explicit.filter((k): k is string => typeof k === 'string').map(parseKeyword).filter((k): k is PlannedKeyword => k !== null)
  }
  const planId = adGroupForIdea({ explicit: idea.audience?.['ad_group'], handles: idea.products.map(p => p.handle), text })
  const plan: AdGroupPlan | undefined = planId ? AD_GROUP_PLANS[planId] : undefined
  if (keywords.length === 0 && plan) keywords = plan.keywords
  if (keywords.length === 0) {
    throw new ExportRefusal('no_keywords', `Idea #${idea.id} has no keywords. Set audience.ad_group (A, A0, B, C or D) or audience.keywords on the idea.`)
  }
  const own = dedupe(idea.headlines)
  const ownBody = dedupe(idea.body)
  const issuesOwn = [
    ...own.filter(h => h.length > RSA_HEADLINE_MAX).map(h => `Headline over ${RSA_HEADLINE_MAX} characters (${h.length}): "${clip(h)}"`),
    ...ownBody.filter(d => d.length > RSA_DESCRIPTION_MAX).map(d => `Description over ${RSA_DESCRIPTION_MAX} characters (${d.length}): "${clip(d)}"`),
  ]
  if (issuesOwn.length) throw new ExportRefusal('policy', issuesOwn.map(s => `Idea #${idea.id}: ${s}`))

  const headlines = [...own]
  for (const h of theme.headlines) if (headlines.length < RSA_HEADLINES_MAX && !headlines.some(x => x.toLowerCase() === h.toLowerCase())) headlines.push(h)
  const descriptions = [...ownBody].slice(0, RSA_DESCRIPTIONS_MAX)
  for (const d of theme.descriptions) if (descriptions.length < RSA_DESCRIPTIONS_MAX && !descriptions.some(x => x.toLowerCase() === d.toLowerCase())) descriptions.push(d)

  const base = idea.destinationUrl && /^https?:\/\//.test(idea.destinationUrl)
    ? idea.destinationUrl
    : plan ? `${SITE}${plan.landing}` : null
  if (!base) throw new ExportRefusal('policy', `Idea #${idea.id} has no destination URL.`)
  let host = ''
  try { host = new URL(base).hostname } catch { throw new ExportRefusal('policy', `Idea #${idea.id} destination is not a valid URL.`) }
  if (host !== 'xdipx.com' && host !== 'www.xdipx.com') throw new ExportRefusal('policy', `Idea #${idea.id} destination host ${host} is not xdipx.com.`)
  const finalUrl = withUtms(base, idea, opts.creativeId ?? null)

  const adGroup = `${idea.id}-${fileSlug(idea.title, 40)}`
  return {
    idea,
    campaign: opts.campaign,
    adGroup,
    keywords,
    maxCpcUsd: typeof idea.audience?.['max_cpc_usd'] === 'number' ? (idea.audience['max_cpc_usd'] as number) : plan?.maxCpcUsd ?? 1.0,
    headlines: headlines.slice(0, RSA_HEADLINES_MAX),
    descriptions: descriptions.slice(0, RSA_DESCRIPTIONS_MAX),
    path1: theme.paths[0].slice(0, RSA_PATH_MAX),
    path2: theme.paths[1].slice(0, RSA_PATH_MAX),
    finalUrl,
    utmContent: utmContentFor({ creativeId: opts.creativeId ?? null, ideaId: idea.id }),
    padded: { headlines: headlines.length - own.length, descriptions: descriptions.length - ownBody.slice(0, RSA_DESCRIPTIONS_MAX).length },
  }
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function money(cents: number): string {
  return (cents / 100).toFixed(2)
}

function googleTable(groups: SearchAdGroup[], campaign: string, budgetCents: number): Table {
  const rows: Row[] = []
  rows.push({
    Campaign: campaign, 'Campaign Type': 'Search', Networks: 'Google search', Languages: 'en',
    Budget: money(budgetCents), 'Budget type': 'Daily', 'Bid Strategy Type': 'Manual CPC', 'Campaign Status': 'Paused',
  })
  rows.push({ Campaign: campaign, Location: 'United States' })
  for (const n of ALL_NEGATIVES) rows.push({ Campaign: campaign, Keyword: n, 'Criterion Type': 'Negative Phrase' })
  for (const g of groups) {
    rows.push({ Campaign: campaign, 'Ad Group': g.adGroup, 'Ad Group Type': 'Standard', 'Max CPC': g.maxCpcUsd.toFixed(2), 'Ad Group Status': 'Paused' })
    for (const k of g.keywords) rows.push({ Campaign: campaign, 'Ad Group': g.adGroup, Keyword: k.text, 'Criterion Type': k.match, Status: 'Paused' })
    const ad: Row = { Campaign: campaign, 'Ad Group': g.adGroup, 'Ad type': 'Responsive search ad', 'Path 1': g.path1, 'Path 2': g.path2, 'Final URL': g.finalUrl, Status: 'Paused' }
    g.headlines.forEach((h, i) => { ad[`Headline ${i + 1}`] = h })
    g.descriptions.forEach((d, i) => { ad[`Description ${i + 1}`] = d })
    rows.push(ad)
  }
  return { columns: [...GOOGLE_COLUMNS], rows }
}

function microsoftTable(groups: SearchAdGroup[], campaign: string, budgetCents: number): Table {
  const rows: Row[] = []
  rows.push({ Type: 'Format Version', Name: '6.0' })
  rows.push({
    Type: 'Campaign', Status: 'Paused', Campaign: campaign, 'Campaign Type': 'Search', Budget: money(budgetCents),
    'Budget Type': 'DailyBudgetStandard', 'Bid Strategy Type': 'ManualCpc', Language: 'English', 'Time Zone': 'PacificTimeUSCanadaTijuana',
  })
  for (const n of ALL_NEGATIVES) rows.push({ Type: 'Campaign Negative Keyword', Status: 'Active', Campaign: campaign, Keyword: n, 'Match Type': 'Phrase' })
  for (const g of groups) {
    rows.push({ Type: 'Ad Group', Status: 'Paused', Campaign: campaign, 'Ad Group': g.adGroup, 'Search Bid': g.maxCpcUsd.toFixed(2), Language: 'English' })
    for (const k of g.keywords) {
      rows.push({ Type: 'Keyword', Status: 'Paused', Campaign: campaign, 'Ad Group': g.adGroup, Keyword: k.text, 'Match Type': k.match, Bid: g.maxCpcUsd.toFixed(2) })
    }
    rows.push({
      Type: 'Responsive Search Ad', Status: 'Paused', Campaign: campaign, 'Ad Group': g.adGroup, 'Final Url': g.finalUrl,
      'Path 1': g.path1, 'Path 2': g.path2,
      Headline: JSON.stringify(g.headlines.map(text => ({ text }))),
      Description: JSON.stringify(g.descriptions.map(text => ({ text }))),
    })
  }
  return { columns: [...MICROSOFT_COLUMNS], rows }
}

// ---------------------------------------------------------------------------
// Serialise and parse
// ---------------------------------------------------------------------------

function cell(v: string, sep: string): string {
  return v.includes(sep) || v.includes('"') || v.includes('\n') || v.includes('\r') ? `"${v.replace(/"/g, '""')}"` : v
}

export function serialiseTable(t: Table, variant: SearchVariant): Buffer {
  const sep = variant === 'google' ? '\t' : ','
  const lines = [t.columns.map(c => cell(c, sep)).join(sep)]
  for (const r of t.rows) lines.push(t.columns.map(c => cell(r[c] ?? '', sep)).join(sep))
  const body = `${lines.join('\r\n')}\r\n`
  if (variant === 'google') return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')])
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body, 'utf8')])
}

/** Decode a file we built (or one Editor exported): BOM decides the encoding. */
export function decodeExport(bytes: Buffer): { text: string; encoding: 'utf-16le' | 'utf-8' } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: bytes.subarray(2).toString('utf16le'), encoding: 'utf-16le' }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: bytes.subarray(3).toString('utf8'), encoding: 'utf-8' }
  return { text: bytes.toString('utf8'), encoding: 'utf-8' }
}

export function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(c => c !== '') || row.length > 1) rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

export interface CsvValidation {
  ok: boolean
  errors: string[]
  encoding: 'utf-16le' | 'utf-8'
  stats: { rows: number; campaigns: number; adGroups: number; keywords: number; negatives: number; ads: number; headlines: number; descriptions: number }
}

/** Re-parse a built file and assert every limit again. The builders call it before storing. */
export function validate(bytes: Buffer, variant: SearchVariant): CsvValidation {
  const { text, encoding } = decodeExport(bytes)
  const errors: string[] = []
  const expectedEncoding = variant === 'google' ? 'utf-16le' : 'utf-8'
  if (encoding !== expectedEncoding) errors.push(`Expected ${expectedEncoding} with a BOM, got ${encoding}`)
  const grid = parseDelimited(text, variant === 'google' ? '\t' : ',')
  const header = grid[0] ?? []
  const stats = { rows: Math.max(0, grid.length - 1), campaigns: 0, adGroups: 0, keywords: 0, negatives: 0, ads: 0, headlines: 0, descriptions: 0 }
  const col = (r: string[], name: string): string => {
    const i = header.indexOf(name)
    return i >= 0 ? (r[i] ?? '') : ''
  }
  const expectedCols = variant === 'google' ? GOOGLE_COLUMNS : MICROSOFT_COLUMNS
  if (header.join('|') !== expectedCols.join('|')) errors.push('Header row does not match the expected English headers')

  for (const r of grid.slice(1)) {
    if (r.length !== header.length) { errors.push(`Row has ${r.length} cells, header has ${header.length}`); continue }
    if (variant === 'google') {
      if (col(r, 'Campaign Status')) { stats.campaigns++; if (col(r, 'Campaign Status') !== 'Paused') errors.push('Campaign is not Paused') }
      if (col(r, 'Ad Group Status')) { stats.adGroups++; if (col(r, 'Ad Group Status') !== 'Paused') errors.push('Ad group is not Paused') }
      const crit = col(r, 'Criterion Type')
      if (crit.startsWith('Negative')) stats.negatives++
      else if (crit) {
        stats.keywords++
        if (crit === 'Broad') errors.push(`Broad match keyword "${col(r, 'Keyword')}" (phrase and exact only)`)
        if (col(r, 'Status') !== 'Paused') errors.push(`Keyword "${col(r, 'Keyword')}" is not Paused`)
      }
      if (col(r, 'Ad type')) {
        stats.ads++
        if (col(r, 'Status') !== 'Paused') errors.push('Ad is not Paused')
        checkAd(HEADLINE_COLS.map(c => col(r, c)).filter(Boolean), DESCRIPTION_COLS.map(c => col(r, c)).filter(Boolean), [col(r, 'Path 1'), col(r, 'Path 2')].filter(Boolean), col(r, 'Final URL'))
      }
    } else {
      const type = col(r, 'Type')
      if (type === 'Campaign') { stats.campaigns++; if (col(r, 'Status') !== 'Paused') errors.push('Campaign is not Paused') }
      if (type === 'Ad Group') { stats.adGroups++; if (col(r, 'Status') !== 'Paused') errors.push('Ad group is not Paused') }
      if (type === 'Campaign Negative Keyword') stats.negatives++
      if (type === 'Keyword') {
        stats.keywords++
        if (col(r, 'Match Type') === 'Broad') errors.push(`Broad match keyword "${col(r, 'Keyword')}" (phrase and exact only)`)
        if (col(r, 'Status') !== 'Paused') errors.push(`Keyword "${col(r, 'Keyword')}" is not Paused`)
      }
      if (type === 'Responsive Search Ad') {
        stats.ads++
        if (col(r, 'Status') !== 'Paused') errors.push('Ad is not Paused')
        let hs: string[] = []
        let ds: string[] = []
        try {
          hs = (JSON.parse(col(r, 'Headline')) as Array<{ text: string }>).map(x => x.text)
          ds = (JSON.parse(col(r, 'Description')) as Array<{ text: string }>).map(x => x.text)
        } catch { errors.push('Headline or Description cell is not valid JSON') }
        checkAd(hs, ds, [col(r, 'Path 1'), col(r, 'Path 2')].filter(Boolean), col(r, 'Final Url'))
      }
    }
  }
  if (stats.ads === 0) errors.push('File has no responsive search ad row')
  if (stats.keywords === 0) errors.push('File has no keyword rows')
  if (stats.negatives === 0) errors.push('File has no negative keywords (they go in before the first impression)')

  function checkAd(hs: string[], ds: string[], paths: string[], url: string): void {
    stats.headlines += hs.length
    stats.descriptions += ds.length
    if (hs.length > RSA_HEADLINES_MAX) errors.push(`More than ${RSA_HEADLINES_MAX} headlines`)
    if (ds.length > RSA_DESCRIPTIONS_MAX) errors.push(`More than ${RSA_DESCRIPTIONS_MAX} descriptions`)
    errors.push(...googleTextIssues({ headlines: hs, descriptions: ds, finalUrl: url, paths }))
    for (const t of [...hs, ...ds]) { const g = glyphIn(t); if (g) errors.push(`Glyph "${g}" survived into the file`) }
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)], encoding, stats }
}

// ---------------------------------------------------------------------------
// The exporter's build
// ---------------------------------------------------------------------------

export interface GoogleBuildInput {
  lane: SearchVariant
  ideas: ExportIdea[]
  /** The text creative row per idea, when one exists (utm_content = its id). */
  creativeIdByIdea: Record<number, number>
  dailyCapCents: number
  now?: Date
}

export function buildSearchExport(input: GoogleBuildInput): ExportBuild {
  if (input.ideas.length === 0) throw new ExportRefusal('no_subjects', 'No ideas to export.')
  const lanes = new Set(input.ideas.map(i => i.lane))
  if (lanes.size !== 1 || !lanes.has(input.lane)) throw new ExportRefusal('mixed_lanes', 'Export google and microsoft ideas separately.')
  const now = input.now ?? new Date()
  const campaign = campaignNameFor(input.ideas, now)
  const groups = input.ideas.map(idea => assembleAdGroup(idea, { creativeId: input.creativeIdByIdea[idea.id] ?? null, campaign, dailyCapCents: input.dailyCapCents }))

  const issues: string[] = []
  for (const g of groups) for (const i of googleTextIssues({ headlines: g.headlines, descriptions: g.descriptions, finalUrl: g.finalUrl, paths: [g.path1, g.path2] })) issues.push(`Idea #${g.idea.id}: ${i}`)
  if (issues.length) throw new ExportRefusal('policy', issues)

  // Budget: the lowest explicit daily budget among the ideas, never above the daily valve.
  const explicit = input.ideas.map(i => i.audience?.['daily_budget_cents']).filter((n): n is number => typeof n === 'number' && n > 0)
  const budgetCents = Math.max(100, Math.min(input.dailyCapCents, explicit.length ? Math.min(...explicit) : input.dailyCapCents))

  const table = input.lane === 'google' ? googleTable(groups, campaign, budgetCents) : microsoftTable(groups, campaign, budgetCents)
  const bytes = serialiseTable(table, input.lane)
  const check = validate(bytes, input.lane)
  if (!check.ok) throw new ExportRefusal('policy', check.errors.map(e => `Built file failed its own check: ${e}`))

  const first = input.ideas[0]!
  const stamp = now.toISOString().slice(0, 10)
  const filename = input.ideas.length === 1
    ? `${input.lane}-search-idea-${first.id}-${stamp}.csv`
    : `${input.lane}-search-${input.ideas.length}-ideas-${stamp}.csv`
  const warnings: string[] = []
  for (const g of groups) {
    if (g.padded.headlines > 0) warnings.push(`Idea #${g.idea.id}: padded ${g.padded.headlines} headline(s) from the approved Search copy bank.`)
    if (g.padded.descriptions > 0) warnings.push(`Idea #${g.idea.id}: padded ${g.padded.descriptions} description(s) from the approved Search copy bank.`)
  }
  warnings.push(`Daily budget set to $${money(budgetCents)} (capped by the daily valve). Everything is Paused.`)
  const destinations: Record<number, string> = {}
  for (const g of groups) { const cid = input.creativeIdByIdea[g.idea.id]; if (cid) destinations[cid] = g.finalUrl }

  return {
    exporter: 'google-editor-csv',
    kind: 'google-editor-csv',
    filename,
    contentType: input.lane === 'google' ? 'text/csv; charset=utf-16le' : 'text/csv; charset=utf-8',
    bytes,
    variant: input.lane,
    destinations,
    summary: {
      lines: [
        `${input.lane === 'google' ? 'Google Ads Editor' : 'Microsoft Advertising Editor'} file: ${check.stats.campaigns} campaign, ${check.stats.adGroups} ad group${check.stats.adGroups === 1 ? '' : 's'}, ${check.stats.keywords} keywords, ${check.stats.negatives} negatives, ${check.stats.ads} responsive search ad${check.stats.ads === 1 ? '' : 's'}`,
        `${check.stats.headlines} headlines, ${check.stats.descriptions} descriptions, encoding ${check.encoding === 'utf-16le' ? 'UTF-16LE with BOM, tab-delimited' : 'UTF-8 with BOM, comma-delimited'}`,
      ],
      counts: { campaigns: check.stats.campaigns, adGroups: check.stats.adGroups, keywords: check.stats.keywords, negatives: check.stats.negatives, ads: check.stats.ads, headlines: check.stats.headlines, descriptions: check.stats.descriptions },
      warnings,
    },
  }
}

export type { ExportCreative }
