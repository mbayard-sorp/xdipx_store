// Tests for the outreach-prospects.md parser, against both a synthetic
// fixture and the real checked-in doc (so a doc reformat that would break
// the seed script fails CI instead of silently seeding nothing).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseProspectsDoc } from './outreach-prospects-doc'

const FIXTURE = `# Outreach Prospects

## Ready

| Domain | Path | Notes |
|---|---|---|
| withemail.com | email media@withemail.com | Pitches via email, original content only. |
| formonly.com | contact form (formonly.com/contact/) | Contributed articles welcome. |
| notesemail.org | email pitch (dig it out) | Address in notes: editor@notesemail.org somewhere. |

## Conditional

| Domain | Path | Caveat |
|---|---|---|
| caveat.com | email contact@caveat.com | Clarify link policy before writing anything. |
| nocontact.net | message via their page | Low priority. |

## Recheck later

| Domain | Why |
|---|---|
| recheck.co.uk | Not currently accepting (sales@recheck.co.uk). |
`

describe('parseProspectsDoc', () => {
  const parsed = parseProspectsDoc(FIXTURE)

  it('extracts only READY/CONDITIONAL rows that have a real email', () => {
    expect(parsed.map(p => p.domain).sort()).toEqual([
      'caveat.com', 'notesemail.org', 'withemail.com',
    ])
  })

  it('never picks up Recheck-section rows, even with an email present', () => {
    expect(parsed.find(p => p.domain === 'recheck.co.uk')).toBeUndefined()
  })

  it('skips form-only and dm-only rows', () => {
    expect(parsed.find(p => p.domain === 'formonly.com')).toBeUndefined()
    expect(parsed.find(p => p.domain === 'nocontact.net')).toBeUndefined()
  })

  it('captures the email, the vetting tier, and the policy note', () => {
    const ready = parsed.find(p => p.domain === 'withemail.com')
    expect(ready).toMatchObject({
      contactEmail: 'media@withemail.com',
      vetting: 'READY',
    })
    expect(ready?.policyNote).toContain('original content only')

    const cond = parsed.find(p => p.domain === 'caveat.com')
    expect(cond).toMatchObject({
      contactEmail: 'contact@caveat.com',
      vetting: 'CONDITIONAL',
    })
    expect(cond?.policyNote).toContain('Clarify link policy')
  })

  it('finds an email anywhere in the row when the Path cell hides it', () => {
    expect(parsed.find(p => p.domain === 'notesemail.org')?.contactEmail)
      .toBe('editor@notesemail.org')
  })

  it('is deterministic and idempotent on re-parse', () => {
    expect(parseProspectsDoc(FIXTURE)).toEqual(parsed)
  })
})

describe('parseProspectsDoc against the real doc', () => {
  const doc = readFileSync(
    fileURLToPath(new URL('../../docs/store-team/outreach-prospects.md', import.meta.url)),
    'utf8',
  )
  const parsed = parseProspectsDoc(doc)

  it('finds the 3 email-reachable prospects after the 2026-08-16 re-verification', () => {
    // 2026-08-16: a live re-verification pass demoted bestsextoys.com,
    // sextoysblog.net, sexdollqueen.com, mynightmate.com and worldsexguide.org
    // out of Ready into Rejected (see docs/store-team/outreach-prospects.md).
    // The two rows that stayed in Ready (carasutra.com, pleasuresuperstore.com)
    // don't have a literal email in the doc, so only the Conditional rows with
    // a real address remain email-reachable.
    expect(parsed.map(p => p.domain).sort()).toEqual([
      'chastityall.com',
      'chastitycage.co',
      'genpink.com',
    ])
  })

  it('every parsed row has a plausible email and a non-empty policy note', () => {
    for (const p of parsed) {
      expect(p.contactEmail).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i)
      expect(p.policyNote.length).toBeGreaterThan(10)
    }
  })
})
