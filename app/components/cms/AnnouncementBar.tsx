import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import type { AnnouncementBarBlock } from '~/types/cms'

interface AnnouncementBarProps {
  block: AnnouncementBarBlock
}

// Doctrine §3 keeps the ♥ as the store's only glyph motif, and reserves it for
// CTA labels, Emma asides, and trust surfaces. The utility bar is none of
// those, and editors had rotated package/lock/bag emoji through it (design-critic
// spot check, 2026-07-29). Strip pictographic emoji and their
// modifiers/joiners/regional-indicator pairs at render time so the bar reads as
// plain text no matter what content is fed to it; a bare ♥ is the one glyph kept.
// Emoji base (with optional skin-tone modifier U+1F3FB-U+1F3FF, VS16 U+FE0F, and
// ZWJ U+200D sequences) or a regional-indicator pair.
const EMOJI_CLUSTER =
  /(?:\p{Extended_Pictographic}(?:[\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]|\p{Extended_Pictographic})*)|[\u{1F1E6}-\u{1F1FF}]/gu

export function stripEmoji(text: string): string {
  return text
    // Keep only a bare ♥ (U+2665) out of each emoji cluster, drop everything else.
    .replace(EMOJI_CLUSTER, cluster => cluster.replace(/[^♥]/gu, ''))
    // Downgrade any surviving emoji-presentation heart (♥️) to plain text.
    .replace(/\uFE0F/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function AnnouncementBar({ block }: AnnouncementBarProps) {
  const { messages, rotationIntervalMs = 4000, bgStyle = 'charcoal' } = block
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (messages.length <= 1) return
    const interval = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex(i => (i + 1) % messages.length)
        setVisible(true)
      }, 300)
    }, rotationIntervalMs)
    return () => clearInterval(interval)
  }, [messages.length, rotationIntervalMs])

  if (!messages.length) return null

  // The legacy 'gradient' style used to map to coral, which spent the
  // viewport's entire coral budget on a utility bar and left the hero CTA
  // fighting it (design-critic BLOCK finding, 2026-07-20). All styles now
  // resolve to quiet grounds; coral stays reserved for the primary CTA.
  const bgClass =
    bgStyle === 'purple' ? 'bg-sage' :
    'bg-ink'

  const msg = messages[index]!

  return (
    <div className={`${bgClass} text-white py-2 px-4 text-center text-sm font-medium`}>
      <span
        className="transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
      >
        {stripEmoji(msg.text)}
        {msg.link && (
          <Link
            to={msg.link}
            className="ml-2 underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity"
          >
            {stripEmoji(msg.linkLabel ?? 'Learn more') || 'Learn more'}
          </Link>
        )}
      </span>
    </div>
  )
}
