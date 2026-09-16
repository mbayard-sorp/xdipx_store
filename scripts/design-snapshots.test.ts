/**
 * Guards the cloud-routine transport accommodations in design-snapshots.ts
 * (ticket #8421). These exist because the mandatory design-critic gate runs
 * from a sandbox where chromium can neither resolve its own browser build nor
 * complete a TLS handshake through the agent proxy, and the recipe for working
 * around that lived in playbook prose where every run had to re-implement it.
 */
import { describe, expect, it } from 'vitest'
import {
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
