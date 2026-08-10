import { describe, expect, it } from 'vitest'

import {
  CITATION_HOST_ALLOWLIST,
  extractTitle,
  validateCitationUrl,
} from './citation-liveness.server'

describe('validateCitationUrl', () => {
  it('accepts an https url on an allowlisted host', () => {
    const r = validateCitationUrl('https://www.clevelandclinic.org/health/articles/22823')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.url.hostname).toBe('www.clevelandclinic.org')
  })

  it('accepts a bare allowlisted domain and its subdomains (suffix match)', () => {
    expect(validateCitationUrl('https://who.int/news').ok).toBe(true)
    expect(validateCitationUrl('https://pubmed.ncbi.nlm.nih.gov/12345/').ok).toBe(true)
  })

  it('rejects a host that only contains an allowlisted domain as a substring', () => {
    // clevelandclinic.org.evil.com must not pass the suffix check
    const r = validateCitationUrl('https://clevelandclinic.org.evil.com/x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('host-not-allowlisted')
  })

  it('rejects a non-allowlisted host', () => {
    const r = validateCitationUrl('https://example.com/article')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('host-not-allowlisted')
  })

  it('rejects http (non-https)', () => {
    const r = validateCitationUrl('http://www.who.int/news')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not-https')
  })

  it('rejects internal / private-looking hosts even over https', () => {
    for (const u of [
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data/',
      'https://10.0.0.5/admin',
    ]) {
      const r = validateCitationUrl(u)
      expect(r.ok).toBe(false)
    }
  })

  it('rejects malformed and empty input', () => {
    expect(validateCitationUrl('not a url').ok).toBe(false)
    expect(validateCitationUrl('').ok).toBe(false)
    expect(validateCitationUrl('   ').ok).toBe(false)
    expect(validateCitationUrl(null).ok).toBe(false)
    expect(validateCitationUrl(42).ok).toBe(false)
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(validateCitationUrl('  https://who.int/news  ').ok).toBe(true)
  })

  it('every allowlisted domain is a plausible bare host (no scheme, no path)', () => {
    for (const d of CITATION_HOST_ALLOWLIST) {
      expect(d).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/)
    }
  })
})

describe('extractTitle', () => {
  it('extracts and trims the first title', () => {
    expect(extractTitle('<html><head><title>  Cock Rings 101 </title></head></html>')).toBe(
      'Cock Rings 101',
    )
  })

  it('decodes common html entities', () => {
    expect(extractTitle('<title>Safe &amp; Sound &#39;guide&#39;</title>')).toBe(
      "Safe & Sound 'guide'",
    )
  })

  it('handles a title tag with attributes', () => {
    expect(extractTitle('<title data-x="y">Hello</title>')).toBe('Hello')
  })

  it('collapses internal whitespace and newlines', () => {
    expect(extractTitle('<title>a\n  long\t title</title>')).toBe('a long title')
  })

  it('returns null when there is no title or it is empty', () => {
    expect(extractTitle('<html><body>no title</body></html>')).toBeNull()
    expect(extractTitle('<title>   </title>')).toBeNull()
  })
})
