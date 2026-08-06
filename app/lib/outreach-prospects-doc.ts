/**
 * Parser for docs/store-team/outreach-prospects.md, the owner-vetted target
 * list. Pure so scripts/seed-outreach-prospects.ts and the tests share one
 * implementation. Only the Ready and Conditional sections are actionable, and
 * only rows whose contact path contains a real email address can be seeded as
 * email prospects; form and DM rows stay in the doc for the human loop.
 */

export interface ParsedProspect {
  domain: string
  contactEmail: string
  /** 'READY' rows carry their Notes; 'CONDITIONAL' rows carry their Caveat. */
  policyNote: string
  vetting: 'READY' | 'CONDITIONAL'
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

/** The markdown table rows inside one `## <heading>` section. */
function sectionRows(markdown: string, heading: string): string[] {
  const lines = markdown.split('\n')
  const start = lines.findIndex(l => l.trim().toLowerCase() === `## ${heading}`.toLowerCase())
  if (start === -1) return []
  const rows: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.startsWith('## ')) break
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    // Skip the header row and the |---| separator.
    if (/^\|[\s|-]+\|$/.test(trimmed)) continue
    if (/^\|\s*Domain\s*\|/i.test(trimmed)) continue
    rows.push(trimmed)
  }
  return rows
}

function cells(row: string): string[] {
  return row.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
}

/**
 * Extract the READY and CONDITIONAL rows that have a real contact email.
 * The email is looked for in the Path/Caveat cell first, then anywhere in
 * the row (some rows put the address in the notes).
 */
export function parseProspectsDoc(markdown: string): ParsedProspect[] {
  const out: ParsedProspect[] = []
  const seen = new Set<string>()
  const sections: Array<{ heading: string; vetting: ParsedProspect['vetting'] }> = [
    { heading: 'Ready', vetting: 'READY' },
    { heading: 'Conditional', vetting: 'CONDITIONAL' },
  ]
  for (const { heading, vetting } of sections) {
    for (const row of sectionRows(markdown, heading)) {
      const c = cells(row)
      if (c.length < 3) continue
      const domain = (c[0] ?? '').toLowerCase()
      if (!domain || !domain.includes('.') || seen.has(domain)) continue
      const email = c[1]?.match(EMAIL_RE)?.[0] ?? row.match(EMAIL_RE)?.[0]
      if (!email) continue
      seen.add(domain)
      out.push({ domain, contactEmail: email, policyNote: c[2] ?? '', vetting })
    }
  }
  return out
}
