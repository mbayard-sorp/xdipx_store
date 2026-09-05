import { describe, expect, it } from 'vitest'

import {
  CITATION_HOST_ALLOWLIST,
  MAX_BODY_TEXT_CHARS,
  classifyStatus,
  extractReadableText,
  extractTitle,
  isChallengePage,
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

describe('extractReadableText (ticket #4285 body excerpt)', () => {
  it('strips tags and returns the prose', () => {
    const html = '<html><body><h1>Cock Rings</h1><p>They restrict blood flow.</p></body></html>'
    expect(extractReadableText(html, MAX_BODY_TEXT_CHARS)).toBe('Cock Rings They restrict blood flow.')
  })

  it('drops script, style, noscript, head and svg contents entirely', () => {
    const html = [
      '<head><title>t</title><meta name="x" content="hidden"></head>',
      '<style>.a{color:red}</style>',
      '<script>var claim = "fake supporting text"</script>',
      '<noscript>enable js</noscript>',
      '<svg><path d="M0 0"/></svg>',
      '<body><p>The real claim the reviewer needs.</p></body>',
    ].join('')
    const text = extractReadableText(html, MAX_BODY_TEXT_CHARS)
    expect(text).toBe('The real claim the reviewer needs.')
    expect(text).not.toContain('fake supporting text')
    expect(text).not.toContain('color:red')
    expect(text).not.toContain('enable js')
  })

  it('decodes common entities and collapses whitespace', () => {
    const html = '<p>water-based\n\n  &amp; silicone   lube&rsquo;s pH</p>'
    expect(extractReadableText(html, MAX_BODY_TEXT_CHARS)).toBe("water-based & silicone lube's pH")
  })

  it('truncates to the char cap', () => {
    const html = `<p>${'a'.repeat(500)}</p>`
    expect(extractReadableText(html, 100)).toHaveLength(100)
  })

  it('returns empty string for a body with no prose', () => {
    expect(extractReadableText('<script>x()</script>', MAX_BODY_TEXT_CHARS)).toBe('')
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

describe('isChallengePage (2xx bot-protection interstitial)', () => {
  it('flags the exact page that shipped ticket #3946 (200 titled "Checking your browser - reCAPTCHA")', () => {
    // Run 362 fetched a PMC article; the endpoint answered live:true status:200
    // but the title was the challenge page, not the paper.
    expect(isChallengePage('Checking your browser - reCAPTCHA', '<html><body>...</body></html>')).toBe(
      true,
    )
  })

  it('flags Cloudflare "Just a moment..." and "Attention Required" titles', () => {
    expect(isChallengePage('Just a moment...', '')).toBe(true)
    expect(isChallengePage('Attention Required! | Cloudflare', '')).toBe(true)
  })

  it('flags challenge machinery in the body even when the title looks innocuous', () => {
    expect(
      isChallengePage(null, '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page"></script>'),
    ).toBe(true)
    expect(isChallengePage('Loading', '<div class="g-recaptcha" data-sitekey="x"></div>')).toBe(true)
    expect(isChallengePage(null, '<script src="https://hcaptcha.com/1/api.js"></script>')).toBe(true)
    expect(isChallengePage('Pardon Our Interruption', 'Incapsula incident ID: 123-456')).toBe(true)
    expect(isChallengePage(null, 'window._pxhd = "..."; var pxCaptcha;')).toBe(true)
    expect(isChallengePage(null, 'Please enable JavaScript and cookies to continue')).toBe(true)
  })

  it('flags a 203 cookie wall with no WAF-vendor machinery (ticket #7739, pubmed.ncbi.nlm.nih.gov)', () => {
    // Reproduced live in content run 705: status 203, title the bare hostname,
    // body the whole cookie wall verbatim.
    expect(
      isChallengePage(
        'pubmed.ncbi.nlm.nih.gov',
        'Cookies must be enabled Enable cookies for pubmed.ncbi.nlm.nih.gov and reload this page to continue.',
      ),
    ).toBe(true)
  })

  it('does not flag a genuine health article that merely mentions captcha/Cloudflare in prose', () => {
    // The real page title from the #3946 citation, plus incidental mentions.
    expect(
      isChallengePage(
        'Menthol and capsaicin activate distinct nerve receptors - PMC',
        'The site was recently migrated behind Cloudflare. Some forms use a captcha to reduce spam.',
      ),
    ).toBe(false)
  })

  it('does not flag empty or plainly-live content', () => {
    expect(isChallengePage(null, '')).toBe(false)
    expect(isChallengePage('Cock Rings 101', '<html><body>A full article.</body></html>')).toBe(false)
  })
})
