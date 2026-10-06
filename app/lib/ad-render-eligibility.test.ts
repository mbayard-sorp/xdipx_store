import { describe, expect, it } from 'vitest'
import { AUTO_PICK_MAX, enqueueSkipReason } from '~/lib/ad-render-eligibility'

describe('enqueueSkipReason', () => {
  it('renders hearted and rendered ideas without an auto pick', () => {
    expect(enqueueSkipReason('hearted')).toBeNull()
    expect(enqueueSkipReason('rendered')).toBeNull()
  })

  it('skips unrated ideas unless the team auto-picks them', () => {
    expect(enqueueSkipReason('proposed')).toBe('idea_proposed')
    expect(enqueueSkipReason('proposed', { autoPick: true })).toBeNull()
  })

  it('never renders an idea the owner rejected or the team archived', () => {
    for (const autoPick of [false, true]) {
      expect(enqueueSkipReason('rejected', { autoPick })).toBe('idea_rejected')
      expect(enqueueSkipReason('archived', { autoPick })).toBe('idea_archived')
    }
  })

  it('keeps the daily auto pick small', () => {
    expect(AUTO_PICK_MAX).toBe(5)
  })
})
