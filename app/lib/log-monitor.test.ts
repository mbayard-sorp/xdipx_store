import { describe, it, expect } from 'vitest'
import {
  isNoiseLine,
  isSignalLine,
  filterAndCapLogs,
  type LogLine,
} from './log-monitor.server'

function line(overrides: Partial<LogLine> & { message: string }): LogLine {
  return {
    timestamp:  '2026-08-19T00:00:00.000Z',
    level:      'info',
    source:     'function',
    deployment: 'dep_1',
    ...overrides,
  }
}

describe('isNoiseLine (#3982)', () => {
  it('classifies bot/crawler 404 scans as noise', () => {
    expect(isNoiseLine(line({ message: 'GET /wp-admin/setup-config.php 404' }))).toBe(true)
    expect(isNoiseLine(line({ message: 'GET /.env 404' }))).toBe(true)
    expect(isNoiseLine(line({ message: 'GET /.git/config 404' }))).toBe(true)
    expect(isNoiseLine(line({ message: 'GET /phpmyadmin/index.php 404' }))).toBe(true)
  })

  it('classifies favicon 404s as noise', () => {
    expect(isNoiseLine(line({ message: 'GET /favicon.ico 404' }))).toBe(true)
  })

  it('classifies OPTIONS preflight 204s as noise', () => {
    expect(isNoiseLine(line({ message: 'OPTIONS /api/cart 204' }))).toBe(true)
  })

  it('classifies healthcheck/uptime pings as noise', () => {
    expect(isNoiseLine(line({ message: 'GET /api/health 200' }))).toBe(true)
    expect(isNoiseLine(line({ message: 'vercel-internal health ping ok' }))).toBe(true)
    expect(isNoiseLine(line({ message: 'healthcheck ok' }))).toBe(true)
  })

  it('classifies expected waitlist validation rejects as noise', () => {
    expect(isNoiseLine(line({ message: 'POST /api/waitlist 400 missing email' }))).toBe(true)
  })

  it('does not classify a real 404 on a normal route as noise', () => {
    expect(isNoiseLine(line({ message: 'GET /products/unknown-slug 404' }))).toBe(false)
  })

  it('does not classify a 500 on the waitlist route as noise', () => {
    expect(isNoiseLine(line({ message: 'POST /api/waitlist 500 db timeout' }))).toBe(false)
  })

  it('never classifies a line as noise if it also matches a signal pattern', () => {
    // Same path family as the noise pattern, but a 500 makes it signal.
    expect(isNoiseLine(line({ message: 'GET /api/health 500 FUNCTION_INVOCATION_FAILED' }))).toBe(false)
  })
})

describe('isSignalLine (#3982)', () => {
  it('flags FUNCTION_INVOCATION_FAILED', () => {
    expect(isSignalLine(line({ message: 'RequestId: abc Task timed out FUNCTION_INVOCATION_FAILED' }))).toBe(true)
  })

  it('flags any 5xx status', () => {
    expect(isSignalLine(line({ message: 'POST /api/webhooks/order-created 500 internal error' }))).toBe(true)
    expect(isSignalLine(line({ message: 'GET /products/foo 503 upstream unavailable' }))).toBe(true)
  })

  it('does not false-positive 5xx match on a 4-digit number', () => {
    expect(isSignalLine(line({ message: 'GET /products/foo 200 took 5000ms' }))).toBe(false)
  })

  it('flags TypeError / ReferenceError / unhandled rejections', () => {
    expect(isSignalLine(line({ message: 'TypeError: Cannot read properties of undefined' }))).toBe(true)
    expect(isSignalLine(line({ message: 'ReferenceError: foo is not defined' }))).toBe(true)
    expect(isSignalLine(line({ message: 'Unhandled promise rejection: Error: db down' }))).toBe(true)
  })

  it('flags Cannot find module and ETIMEDOUT/ECONNRESET', () => {
    expect(isSignalLine(line({ message: "Cannot find module 'build/server/index.js'" }))).toBe(true)
    expect(isSignalLine(line({ message: 'connect ETIMEDOUT 1.2.3.4:443' }))).toBe(true)
    expect(isSignalLine(line({ message: 'read ECONNRESET' }))).toBe(true)
  })

  it('flags a stack trace frame', () => {
    expect(isSignalLine(line({ message: '    at Object.<anonymous> (/var/task/server/index.js:12:34)' }))).toBe(true)
  })

  it('flags lines with level=error even without a matching keyword', () => {
    expect(isSignalLine(line({ level: 'error', message: 'something unexpected happened' }))).toBe(true)
  })

  it('does not flag routine 2xx traffic', () => {
    expect(isSignalLine(line({ message: 'GET /products/vibe-101 200 34ms' }))).toBe(false)
  })
})

describe('filterAndCapLogs (#3982)', () => {
  it('drops known-noise lines and reports the count', () => {
    const logs: LogLine[] = [
      line({ message: 'GET /wp-admin 404' }),
      line({ message: 'GET /api/health 200' }),
      line({ message: 'GET /products/foo 200' }),
    ]
    const { keptLogs, noiseSuppressed } = filterAndCapLogs(logs)
    expect(noiseSuppressed).toBe(2)
    expect(keptLogs).toHaveLength(1)
    expect(keptLogs[0]!.message).toBe('GET /products/foo 200')
  })

  it('a seeded 500/traceback survives filtering and capping even under a tiny budget', () => {
    // Simulate a large window of routine INFO noise-free traffic (not noise
    // per the def, just ordinary logs) with one real incident buried at the
    // very start (oldest / least "recent"), which is the worst case for a
    // recency-based cap.
    const routine: LogLine[] = Array.from({ length: 500 }, (_, i) => line({
      timestamp: new Date(2026, 7, 19, 0, 0, i).toISOString(),
      message:   `GET /products/item-${i} 200 ${20 + (i % 10)}ms`,
    }))

    const incident = line({
      timestamp: '2026-08-19T00:00:00.000Z', // oldest timestamp in the window
      level:     'error',
      message:   'POST /api/webhooks/order-created 500 FUNCTION_INVOCATION_FAILED\n    at handler (/var/task/server/webhooks.js:88:12)',
    })

    const logs = [incident, ...routine]

    // Tiny budget (400 tokens ~= 1600 chars) — far smaller than the routine
    // traffic alone, so most INFO lines must be truncated.
    const { keptLogs, capTruncated } = filterAndCapLogs(logs, 400)

    expect(capTruncated).toBeGreaterThan(0)
    expect(keptLogs.some((l) => l.message.includes('FUNCTION_INVOCATION_FAILED'))).toBe(true)
    expect(keptLogs.some((l) => l.message.includes('500'))).toBe(true)
  })

  it('keeps ALL signal lines uncapped even if their combined size exceeds the budget', () => {
    const manyErrors: LogLine[] = Array.from({ length: 50 }, (_, i) => line({
      timestamp: new Date(2026, 7, 19, 0, 0, i).toISOString(),
      level:     'error',
      message:   `POST /api/webhooks/order-created 500 attempt ${i} db timeout ETIMEDOUT`,
    }))

    // Budget far too small to hold even one line comfortably alongside others.
    const { keptLogs, capTruncated } = filterAndCapLogs(manyErrors, 10)

    expect(keptLogs).toHaveLength(50) // nothing signal-classified is ever dropped
    expect(capTruncated).toBe(0)
  })

  it('fills the remaining budget with the MOST RECENT routine lines, oldest truncated first', () => {
    const logs: LogLine[] = Array.from({ length: 20 }, (_, i) => line({
      timestamp: new Date(2026, 7, 19, 0, 0, i).toISOString(),
      message:   `GET /products/item-${i} 200 20ms`, // ~30 chars each
    }))

    // Budget for roughly half the lines.
    const budgetTokens = Math.ceil((30 * 10) / 4)
    const { keptLogs } = filterAndCapLogs(logs, budgetTokens)

    const keptIndexes = keptLogs.map((l) => Number(l.message.match(/item-(\d+)/)![1]))
    // The most recent (highest index) lines should be the ones kept.
    expect(Math.min(...keptIndexes)).toBeGreaterThan(0)
    expect(keptIndexes).toContain(19)
  })

  it('returns nothing to keep and reports the drop when the whole window is noise', () => {
    const logs: LogLine[] = [
      line({ message: 'GET /wp-admin 404' }),
      line({ message: 'GET /favicon.ico 404' }),
      line({ message: 'OPTIONS /api/cart 204' }),
    ]
    const { keptLogs, noiseSuppressed, capTruncated } = filterAndCapLogs(logs)
    expect(keptLogs).toHaveLength(0)
    expect(noiseSuppressed).toBe(3)
    expect(capTruncated).toBe(0)
  })
})
