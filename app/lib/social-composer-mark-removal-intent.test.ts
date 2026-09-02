/**
 * `handleComposerIntent`'s `mark-removal-owner` branch (ticket #6758) — the
 * dispatch wiring behind the Composer's "I removed this" action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~/lib/social-studio.server', () => ({
  createOwnerDraft: vi.fn(),
  getLibraryAssetsByIds: vi.fn(),
  loadComposerPost: vi.fn(),
  parseOwnerDraft: vi.fn(),
  updateOwnerDraft: vi.fn(),
}))

vi.mock('~/lib/social-publish-approve.server', () => ({
  revertSocialPostToDraft: vi.fn(),
  markSocialPostRemovalOwner: vi.fn(),
}))

import { handleComposerIntent } from './social-composer.server'
import { markSocialPostRemovalOwner } from '~/lib/social-publish-approve.server'

function form(fields: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.append(k, v)
  return f
}

describe('handleComposerIntent — mark-removal-owner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls markSocialPostRemovalOwner and reports success', async () => {
    vi.mocked(markSocialPostRemovalOwner).mockResolvedValue({ ok: true })
    const result = await handleComposerIntent(form({ intent: 'mark-removal-owner' }), 145)
    expect(markSocialPostRemovalOwner).toHaveBeenCalledWith(145)
    expect(result).toEqual({ ok: true, id: 145, intent: 'mark-removal-owner' })
  })

  it('surfaces a refusal (e.g. the post is not deleted yet)', async () => {
    vi.mocked(markSocialPostRemovalOwner).mockResolvedValue({ ok: false, status: 409, error: 'not deleted' })
    const result = await handleComposerIntent(form({ intent: 'mark-removal-owner' }), 145)
    expect(result).toEqual({ ok: false, error: 'not deleted' })
  })

  it('refuses with no id (a brand-new, unsaved draft cannot have been removed)', async () => {
    const result = await handleComposerIntent(form({ intent: 'mark-removal-owner' }), null)
    expect(result).toEqual({ ok: false, error: 'Nothing to mark yet' })
    expect(markSocialPostRemovalOwner).not.toHaveBeenCalled()
  })
})
