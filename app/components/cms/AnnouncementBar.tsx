import { useState, useEffect } from 'react'
import { Link } from 'react-router'
import type { AnnouncementBarBlock } from '~/types/cms'

interface AnnouncementBarProps {
  block: AnnouncementBarBlock
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
        {msg.text}
        {msg.link && (
          <Link
            to={msg.link}
            className="ml-2 underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity"
          >
            {msg.linkLabel ?? 'Learn more'}
          </Link>
        )}
      </span>
    </div>
  )
}
