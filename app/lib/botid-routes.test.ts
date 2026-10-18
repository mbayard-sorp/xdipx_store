import { describe, expect, it } from 'vitest'
import { BOTID_PROTECTED_ROUTES } from './botid-routes'

describe('BOTID_PROTECTED_ROUTES', () => {
  it('lists the single-fetch .data twin next to every bare POST path', () => {
    const paths = BOTID_PROTECTED_ROUTES.map(r => r.path)
    for (const p of paths.filter(p => !p.endsWith('.data'))) {
      expect(paths).toContain(`${p}.data`)
    }
    expect(paths).toContain('/api/lead.data')
    expect(BOTID_PROTECTED_ROUTES.every(r => r.method === 'POST')).toBe(true)
  })
})
