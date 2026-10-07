/**
 * Guards the cloud-routine transport accommodations in design-snapshots.ts
 * (ticket #8421). These exist because the mandatory design-critic gate runs
 * from a sandbox where chromium can neither resolve its own browser build nor
 * complete a TLS handshake through the agent proxy, and the recipe for working
 * around that lived in playbook prose where every run had to re-implement it.
 */
import { describe, expect, it } from 'vitest'
import {
  abortIsRenderCritical,
  looksLikeEdgeBlock,
  parseCurlHeaderDump,
  parseViewports,
  resolveExecutablePath,
  sanitizeResponseHeaders,
  shouldUseFetchTransport,
} from './design-snapshots'

describe('shouldUseFetchTransport', () => {
  const proxied = { HTTPS_PROXY: 'http://127.0.0.1:41213' } as NodeJS.ProcessEnv

  it('intercepts a remote origin when an HTTPS proxy is in the environment', () => {
    expect(shouldUseFetchTransport('https://xdipx.com', proxied)).toBe(true)
  })

  it('leaves chromium alone when there is no proxy', () => {
    expect(shouldUseFetchTransport('https://xdipx.com', {})).toBe(false)
  })

  it('leaves a local dev server alone even behind a proxy', () => {
    // Loopback is reached directly; interception would only add failure modes.
    expect(shouldUseFetchTransport('http://localhost:3000', proxied)).toBe(false)
    expect(shouldUseFetchTransport('http://127.0.0.1:3000', proxied)).toBe(false)
  })

  it('honours the lowercase and ALL_PROXY spellings', () => {
    expect(shouldUseFetchTransport('https://xdipx.com', { https_proxy: 'http://p:1' })).toBe(true)
    expect(shouldUseFetchTransport('https://xdipx.com', { ALL_PROXY: 'http://p:1' })).toBe(true)
  })

  it('lets the flags override the detection in both directions', () => {
    expect(shouldUseFetchTransport('https://xdipx.com', {}, { force: true })).toBe(true)
    expect(shouldUseFetchTransport('https://xdipx.com', proxied, { disable: true })).toBe(false)
  })

  it('does not intercept when the base is unparseable', () => {
    expect(shouldUseFetchTransport('not a url', proxied)).toBe(false)
  })
})

describe('resolveExecutablePath', () => {
  const env = { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' } as NodeJS.ProcessEnv
  const exists = (p: string) => p === '/opt/pw-browsers/chromium'

  it('resolves nothing while Playwright can find its own browser', () => {
    // The bundled build is present, so overriding it would be wrong.
    expect(resolveExecutablePath(env, { exists })).toBeUndefined()
  })

  it('falls back to the pre-installed binary once the bundled build is missing', () => {
    expect(resolveExecutablePath(env, { bundledMissing: true, exists })).toBe('/opt/pw-browsers/chromium')
  })

  it('prefers an explicit flag over everything, with no filesystem check', () => {
    expect(resolveExecutablePath(env, { explicit: '/custom/chrome', exists })).toBe('/custom/chrome')
  })

  it('prefers PLAYWRIGHT_CHROMIUM_EXECUTABLE over the fallback', () => {
    const withEnv = { ...env, PLAYWRIGHT_CHROMIUM_EXECUTABLE: '/env/chrome' }
    expect(resolveExecutablePath(withEnv, { bundledMissing: true, exists })).toBe('/env/chrome')
  })

  it('gives up rather than guessing when the image has no browsers path', () => {
    expect(resolveExecutablePath({}, { bundledMissing: true, exists })).toBeUndefined()
  })

  it('treats PLAYWRIGHT_BROWSERS_PATH=0 as "bundled only", not as a directory', () => {
    expect(resolveExecutablePath({ PLAYWRIGHT_BROWSERS_PATH: '0' }, { bundledMissing: true, exists }))
      .toBeUndefined()
  })

  it('does not invent a path when the pre-installed binary is absent', () => {
    expect(resolveExecutablePath(env, { bundledMissing: true, exists: () => false })).toBeUndefined()
  })
})

describe('sanitizeResponseHeaders', () => {
  it('drops the body-framing headers that no longer describe the fulfilled body', () => {
    // Node's fetch already decompressed the payload; replaying content-encoding
    // would make chromium try to gunzip plain bytes and render a blank page.
    const headers = sanitizeResponseHeaders([
      ['content-type', 'text/html; charset=utf-8'],
      ['Content-Encoding', 'br'],
      ['content-length', '12345'],
      ['Transfer-Encoding', 'chunked'],
      ['connection', 'keep-alive'],
      ['x-vercel-cache', 'MISS'],
    ])
    expect(headers).toEqual({
      'content-type': 'text/html; charset=utf-8',
      'x-vercel-cache': 'MISS',
    })
  })
})

describe('parseViewports', () => {
  it('keeps "both" meaning the historical mobile+desktop pair', () => {
    expect(parseViewports('both')).toEqual(['mobile', 'desktop'])
  })

  it('expands "doctrine" to the 375/768/1440 set the design-critic gate scores', () => {
    expect(parseViewports('doctrine')).toEqual(['mobile', 'tablet', 'wide'])
  })

  it('accepts a single name and a comma list', () => {
    expect(parseViewports('mobile')).toEqual(['mobile'])
    expect(parseViewports('mobile, wide')).toEqual(['mobile', 'wide'])
  })
})

/**
 * Run 1298. The transport moved off Node's `fetch` because Vercel's bot
 * protection answers undici with a 403 edge page while curl, from the same
 * machine and the same proxy, gets a 200. The expensive part was not the block
 * itself: chromium rendered the block page, the CLI wrote three PNGs and
 * printed `done`, and the design-critic gate was handed screenshots of an error
 * page that it had to detect on its own. These guard the detection so a refused
 * capture can never again be reported as a successful one.
 */
describe('looksLikeEdgeBlock', () => {
  const blockPage =
    '<html><head><title>Forbidden</title></head><body><h1>This request was blocked</h1>' +
    '<p>403 FORBIDDEN</p><p>cle1::1791382284-u6yVY2RTbdUoVgkcx8dtARDNz7SMMhrG</p></body></html>'

  it('flags the Vercel bot-wall page that run 1298 captured three times', () => {
    expect(looksLikeEdgeBlock(403, blockPage)).toBe(true)
  })

  it('flags the bare 403 FORBIDDEN variant', () => {
    expect(looksLikeEdgeBlock(403, '<h1>Forbidden</h1><p>403 FORBIDDEN</p>')).toBe(true)
  })

  it('never flags a 200, however the page reads', () => {
    // The storefront legitimately ships the words "blocked" (card_art_blocked)
    // and could ship "403" in Notebook copy. A served 200 is the site.
    expect(looksLikeEdgeBlock(200, blockPage)).toBe(false)
    expect(looksLikeEdgeBlock(200, '<p>This request was blocked</p>')).toBe(false)
  })

  it('does not flag an ordinary 404, which is a real page worth capturing', () => {
    expect(looksLikeEdgeBlock(404, '<h1>Not found</h1><p>No such product.</p>')).toBe(false)
  })
})

describe('parseCurlHeaderDump', () => {
  it('reads status and headers off a single response', () => {
    const { status, headers } = parseCurlHeaderDump(
      'HTTP/2 200\r\ncontent-type: text/html; charset=utf-8\r\nx-vercel-cache: HIT\r\n',
    )
    expect(status).toBe(200)
    expect(headers).toContainEqual(['content-type', 'text/html; charset=utf-8'])
    expect(headers).toContainEqual(['x-vercel-cache', 'HIT'])
  })

  it('takes the FINAL hop when curl followed a redirect', () => {
    // --location dumps one block per hop. Reading the first would report the
    // 302 and the redirect's headers as though they described the body on disk.
    const { status, headers } = parseCurlHeaderDump(
      'HTTP/2 302\r\nlocation: https://xdipx.com/admin/login\r\n\r\n' +
      'HTTP/2 200\r\ncontent-type: text/html\r\n',
    )
    expect(status).toBe(200)
    expect(headers).toContainEqual(['content-type', 'text/html'])
    expect(headers.find(([k]) => k === 'location')).toBeUndefined()
  })

  it('lowercases header names so sanitizeResponseHeaders can match them', () => {
    const { headers } = parseCurlHeaderDump('HTTP/2 200\r\nContent-Encoding: gzip\r\n')
    expect(headers).toContainEqual(['content-encoding', 'gzip'])
    // And the sanitizer must then strip it: curl --compressed already decoded
    // the body, so re-sending the encoding header makes chromium gunzip plain
    // bytes and render nothing.
    expect(sanitizeResponseHeaders(headers)).not.toHaveProperty('content-encoding')
  })

  it('survives a dump with no headers at all', () => {
    expect(parseCurlHeaderDump('HTTP/2 204\r\n')).toEqual({ status: 204, headers: [] })
  })
})

/**
 * QA gate, run 1298. The agent proxy drops connections intermittently (a bare
 * curl of the homepage through it reset on 1 of 6 attempts, with no script
 * involved). Two captures in that gate's own testing wrote a PNG and exited 0
 * while having aborted `entry.client`, `motion` and other JS bundles — so the
 * page never hydrated and nothing said so. Because Reveal renders its final
 * state on the server, the screenshot still looked plausible. That is the same
 * silent wrong answer the curl rewrite exists to prevent, one layer down.
 */
describe('abortIsRenderCritical', () => {
  it('treats a dropped script as render-critical', () => {
    // With entry.client aborted the page never hydrates and the PNG still
    // looks fine, which is exactly why this cannot be shrugged off.
    expect(abortIsRenderCritical('https://xdipx.com/assets/entry.client-eDgH7t3O.js', 'script')).toBe(true)
    expect(abortIsRenderCritical('https://xdipx.com/assets/motion-DYP7mUpq.js', 'script')).toBe(true)
  })

  it('treats the document and stylesheets as render-critical', () => {
    expect(abortIsRenderCritical('https://xdipx.com/', 'document')).toBe(true)
    expect(abortIsRenderCritical('https://xdipx.com/assets/app-x.css', 'stylesheet')).toBe(true)
  })

  it('does not fail a capture over a dropped image, font or video', () => {
    // A missing image leaves a visible gap the critic can see and judge, so it
    // degrades the capture honestly rather than silently.
    expect(abortIsRenderCritical('https://cdn.shopify.com/s/files/1/0/53906B.jpg', 'image')).toBe(false)
    expect(abortIsRenderCritical('https://xdipx.com/assets/newsreader.woff2', 'font')).toBe(false)
    expect(abortIsRenderCritical('https://xdipx.com/hero.mp4', 'media')).toBe(false)
  })

  it('does not fail a capture over analytics beacons and XHR', () => {
    // The original doc comment's own case: a third-party beacon that will not
    // load must not blank the page or fail the run.
    expect(abortIsRenderCritical('https://www.google-analytics.com/g/collect', 'xhr')).toBe(false)
    expect(abortIsRenderCritical('https://xdipx.com/api/x', 'fetch')).toBe(false)
  })
})
