import { describe, expect, it } from 'vitest'
import { isCrawlerUserAgent } from '~/lib/crawler-ua.server'

/**
 * This gate decides whether a page view is worth a paid Haiku generation. A
 * false positive costs one personalized sentence; a false negative costs money
 * on every page of a catalog walk, which is how emma-aside became ~47% of all
 * metered spend. The asymmetry is why the generic tokens are broad.
 */

describe('isCrawlerUserAgent', () => {
  const crawlers = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (compatible; YandexBot/3.0)',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    'Mozilla/5.0 (compatible; SemrushBot/7~bl)',
    'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.0; +https://openai.com/gptbot',
    'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    'Mozilla/5.0 (compatible; PerplexityBot/1.0)',
    'facebookexternalhit/1.1',
    'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36',
    'python-requests/2.31.0',
    'curl/8.4.0',
    'Wget/1.21.3',
    'node-fetch/1.0',
    'axios/1.6.0',
    'xdipx-homepage-healthcheck',
    'xdipx-category-healthcheck',
  ]

  for (const ua of crawlers) {
    it(`treats ${ua.slice(0, 42)} as automated`, () => {
      expect(isCrawlerUserAgent(ua)).toBe(true)
    })
  }

  const humans = [
    // Chrome on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    // Safari on iPhone, the store's dominant real device
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    // Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
    // Chrome on Android
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    // Edge
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  ]

  for (const ua of humans) {
    it(`lets a real browser through: ${ua.slice(0, 38)}`, () => {
      expect(isCrawlerUserAgent(ua)).toBe(false)
    })
  }

  it('treats an absent or blank user-agent as automated', () => {
    // No real browser omits it, and a blank UA is the cheapest crawler disguise.
    expect(isCrawlerUserAgent(null)).toBe(true)
    expect(isCrawlerUserAgent(undefined)).toBe(true)
    expect(isCrawlerUserAgent('')).toBe(true)
    expect(isCrawlerUserAgent('   ')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isCrawlerUserAgent('GOOGLEBOT/2.1')).toBe(true)
    expect(isCrawlerUserAgent('CURL/8.4.0')).toBe(true)
  })
})
