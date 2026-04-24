import { useEffect, useId, useRef, useState } from 'react'
import type { HeroVideo } from '~/types'
import { useActiveVideo } from './ActiveVideoContext'

interface CardVideoProps {
  cardId: string
  video:  HeroVideo
  title:  string
}

export function CardVideo({ cardId, video, title }: CardVideoProps) {
  const active = useActiveVideo()
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef  = useRef<HTMLDivElement>(null)
  const localId  = useId()
  const id = `${cardId}-${localId}`
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || !active) return
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            setVisible(true)
            active.claim(id)
          } else if (e.intersectionRatio < 0.2) {
            setVisible(false)
            active.release(id)
          }
        }
      },
      { threshold: [0.2, 0.6] },
    )
    io.observe(el)
    return () => { io.disconnect(); active.release(id) }
  }, [active, id])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !active) return
    if (active.activeId === id && visible) {
      v.play().catch(() => { /* autoplay blocked — poster remains */ })
    } else {
      v.pause()
    }
  }, [active, id, visible])

  const onEnter = () => {
    if (!active) return
    active.claim(id)
    setVisible(true)
  }
  const onLeave = () => {
    if (!active) return
    active.release(id)
    const v = videoRef.current
    if (v) { v.pause(); v.currentTime = 0 }
  }

  const toggleMute = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (active) active.setMuted(!active.muted)
  }

  const muted = active?.muted ?? true
  const duration = formatDuration(video.duration)

  return (
    <div
      ref={wrapRef}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="w-full h-full relative"
    >
      <video
        ref={videoRef}
        src={video.src}
        poster={video.poster}
        muted={muted}
        playsInline
        loop
        preload="metadata"
        aria-label={title}
        className="w-full h-full object-cover"
      />
      {duration && (
        <span className="absolute bottom-2 left-2 bg-ink/70 text-white text-[10px] font-mono px-1.5 py-0.5 rounded-full pointer-events-none">
          ▶ {duration}
        </span>
      )}
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? 'Unmute video' : 'Mute video'}
        className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-ink/70 text-white flex items-center justify-center hover:bg-ink transition-colors"
      >
        <MuteIcon muted={muted} />
      </button>
    </div>
  )
}

function formatDuration(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function MuteIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v2.18l2.45 2.45A4.52 4.52 0 0 0 16.5 12zM4 4.27l2.73 2.73H3v6h4l5 5v-5.73l4.25 4.25a6.94 6.94 0 0 1-1.75.43v2.02A9 9 0 0 0 18.91 17l1.93 1.93 1.41-1.41L4 4.27z"/>
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/>
    </svg>
  )
}
