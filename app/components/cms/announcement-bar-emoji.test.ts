import { describe, it, expect } from 'vitest'
import { stripEmoji } from './AnnouncementBar'

/**
 * Announcement-bar emoji strip (ticket #337, design-critic spot check
 * 2026-07-29). Doctrine §3 makes ♥ the store's only glyph motif and reserves it
 * for CTA labels, Emma asides, and trust surfaces. Editors had rotated
 * package/lock/bag emoji through the utility bar, which is none of those. The
 * fix is a render-time guard so the bar carries no emoji regardless of the
 * Sanity content fed to it; a bare ♥ is the single glyph kept.
 */
describe('stripEmoji (announcement bar guard)', () => {
  it('drops the rotated package/lock/bag emoji', () => {
    expect(stripEmoji('📦 Free discreet shipping over $75')).toBe('Free discreet shipping over $75')
    expect(stripEmoji('🔒 Secure checkout')).toBe('Secure checkout')
    expect(stripEmoji('🛍️ Shop the edit')).toBe('Shop the edit')
  })

  it('leaves plain text untouched', () => {
    expect(stripEmoji('Discreet billing as XDIPX')).toBe('Discreet billing as XDIPX')
  })

  it('keeps a bare ♥ and downgrades the emoji-presentation heart to text', () => {
    expect(stripEmoji('Ships free ♥')).toBe('Ships free ♥')
    expect(stripEmoji('Loved by thousands ♥️')).toBe('Loved by thousands ♥')
  })

  it('strips ZWJ sequences, regional-indicator flags, and multi-emoji runs', () => {
    expect(stripEmoji('👩‍❤️‍👨 couples faves 🇺🇸')).toBe('couples faves')
    expect(stripEmoji('New in ✨🔥')).toBe('New in')
  })

  it('leaves no non-heart emoji in any output', () => {
    const inputs = ['📦🔒🛍️', 'a 😀 b 🎉 c', '⭐ pick ⭐', '💦 tonight 🔥']
    for (const input of inputs) {
      // Every Extended_Pictographic char except ♥ must be gone.
      const leftover = stripEmoji(input).match(/\p{Extended_Pictographic}/gu) ?? []
      expect(leftover.every(c => c === '♥')).toBe(true)
    }
  })
})
