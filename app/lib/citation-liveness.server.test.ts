import { describe, expect, it } from 'vitest'

import {
  CITATION_HOST_ALLOWLIST,
  classifyStatus,
  extractTitle,
  resolveRedirectTarget,
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

describe('classifyStatus (blocked vs dead)', () => {
  it('classes 2xx as live', () => {
    expect(classifyStatus(200)).toBe('live')
    expect(classifyStatus(204)).toBe('live')
  })

  it('classes 3xx as redirect', () => {
    expect(classifyStatus(301)).toBe('redirect')
    expect(classifyStatus(302)).toBe('redirect')
    expect(classifyStatus(308)).toBe('redirect')
  })

  it('classes a WAF/bot refusal (401/403/429) as blocked, distinct from dead', () => {
    // A refused page is not a gone page: mayoclinic.org returns 403 to the fixed
    // user-agent even at its bare origin, and that must not read as a 404.
    expect(classifyStatus(401)).toBe('blocked')
    expect(classifyStatus(403)).toBe('blocked')
    expect(classifyStatus(429)).toBe('blocked')
  })

  it('classes a genuine 404/410 (and other non-2xx) as dead', () => {
    expect(classifyStatus(404)).toBe('dead')
    expect(classifyStatus(410)).toBe('dead')
    expect(classifyStatus(500)).toBe('dead')
  })
})

describe('resolveRedirectTarget', () => {
  const cdc = new URL('https://www.cdc.gov/')

  it('follows a same-host canonicalizing redirect (www→apex on the allowlist)', () => {
    // https://www.cdc.gov/ 301s to its canonical form; the target host is
    // itself allowlisted, so it is followed and the page reads live.
    const r = resolveRedirectTarget(cdc, 'https://www.cdc.gov/index.html')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.url.hostname).toBe('www.cdc.gov')
  })

  it('follows a redirect to a different but still-allowlisted host', () => {
    const r = resolveRedirectTarget(cdc, 'https://www.nih.gov/health')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.url.hostname).toBe('www.nih.gov')
  })

  it('resolves a relative Location against the source URL', () => {
    const r = resolveRedirectTarget(cdc, '/health/index.html')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.url.href).toBe('https://www.cdc.gov/health/index.html')
  })

  it('refuses a redirect pointing off the allowlist', () => {
    const r = resolveRedirectTarget(cdc, 'https://evil.example.com/x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('redirect-off-allowlist')
  })

  it('refuses a redirect to a look-alike host (suffix check holds across a hop)', () => {
    const r = resolveRedirectTarget(cdc, 'https://cdc.gov.evil.com/x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('redirect-off-allowlist')
  })

  it('refuses a downgrade to http even on an allowlisted host', () => {
    const r = resolveRedirectTarget(cdc, 'http://www.cdc.gov/health')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('redirect-off-allowlist')
  })

  it('refuses a missing or empty Location', () => {
    expect(resolveRedirectTarget(cdc, null).ok).toBe(false)
    expect(resolveRedirectTarget(cdc, '   ').ok).toBe(false)
  })
})
