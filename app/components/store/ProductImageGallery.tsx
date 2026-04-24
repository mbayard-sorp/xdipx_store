import { useState, useRef, useCallback, useEffect } from 'react'

// ─── Gallery media types ──────────────────────────────────────────────────────

export type GalleryItem =
  | { kind: 'image'; url: string; altText: string }
  | {
      kind:       'video'
      previewUrl: string
      sources:    { url: string; mimeType: string }[]
      aspect?:    'portrait' | 'landscape' | 'square'
      /** Optional duration (seconds) — rendered as a thumbnail chip when present. */
      duration?:  number
    }

interface ProductImageGalleryProps {
  items: GalleryItem[]
  alt: string
  activeIndex: number
  onSelectIndex: (i: number) => void
  discountBadge?: React.ReactNode
  shareOverlay?: React.ReactNode
  heartOverlay?: React.ReactNode
}

function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `▶ ${m}:${r.toString().padStart(2, '0')}`
}

const ZOOM_IN_CURSOR =`url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><circle cx='12' cy='12' r='10' fill='white' stroke='%231E1A2E' stroke-width='2'/><line x1='19' y1='19' x2='28' y2='28' stroke='%231E1A2E' stroke-width='3' stroke-linecap='round'/><line x1='8' y1='12' x2='16' y2='12' stroke='%231E1A2E' stroke-width='2'/><line x1='12' y1='8' x2='12' y2='16' stroke='%231E1A2E' stroke-width='2'/></svg>") 12 12, zoom-in`

const ZOOM_OUT_CURSOR = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><circle cx='12' cy='12' r='10' fill='white' stroke='%231E1A2E' stroke-width='2'/><line x1='19' y1='19' x2='28' y2='28' stroke='%231E1A2E' stroke-width='3' stroke-linecap='round'/><line x1='8' y1='12' x2='16' y2='12' stroke='%231E1A2E' stroke-width='2'/></svg>") 12 12, zoom-out`

export function ProductImageGallery({
  items,
  alt,
  activeIndex,
  onSelectIndex,
  discountBadge,
  shareOverlay,
  heartOverlay,
}: ProductImageGalleryProps) {
  const firstIsVideo = items[0]?.kind === 'video'
  const [lockedIndex, setLockedIndex] = useState(activeIndex)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [isZoomed, setIsZoomed] = useState(false)
  // Video state: 'idle' = show preview, 'playing-muted' = autoplay silent, 'playing' = full playback
  const [videoState, setVideoState] = useState<'idle' | 'playing-muted' | 'playing'>(
    firstIsVideo ? 'playing-muted' : 'idle',
  )
  // Source-declared aspect is authoritative; metadata fallback only fills in when unknown
  const [videoAspectFallback, setVideoAspectFallback] = useState<'square' | 'portrait' | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const isInitialMount = useRef(true)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  const displayIndex = previewIndex ?? lockedIndex
  const activeItem = items[displayIndex]
  const isVideoActive = activeItem?.kind === 'video'
  const isPlaying = videoState !== 'idle'

  // Sync locked index when parent changes it (e.g. variant selection)
  useEffect(() => {
    setLockedIndex(activeIndex)
  }, [activeIndex])

  // Reset state when displayed item changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    setIsZoomed(false)
    setVideoState('idle')
    setVideoAspectFallback(null)
    if (imageRef.current) {
      imageRef.current.style.transformOrigin = '50% 50%'
    }
  }, [displayIndex])

  // Pick the best playable source — prefer mp4, fall back to first available
  const videoSrc = isVideoActive
    ? (() => {
        const sources = (activeItem as Extract<GalleryItem, { kind: 'video' }>).sources
        return sources.find(s => s.mimeType.includes('mp4'))?.url ?? sources[0]?.url
      })()
    : undefined

  // Source-declared aspect wins; metadata only fills in when the source didn't say.
  const declaredAspect = isVideoActive
    ? (activeItem as Extract<GalleryItem, { kind: 'video' }>).aspect ?? null
    : null
  const effectiveAspect: 'portrait' | 'square' | 'landscape' =
    declaredAspect ?? videoAspectFallback ?? 'square'
  const isPortrait = effectiveAspect === 'portrait'

  const handleVideoMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    if (declaredAspect) return
    const v = e.currentTarget
    setVideoAspectFallback(v.videoHeight > v.videoWidth ? 'portrait' : 'square')
  }, [declaredAspect])

  // Touch pan: attach non-passive listener to allow preventDefault
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function handleTouchMove(e: TouchEvent) {
      if (!isZoomed || !containerRef.current || !imageRef.current) return
      e.preventDefault()
      const touch = e.touches[0]
      if (!touch) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(100, ((touch.clientX - rect.left) / rect.width) * 100))
      const y = Math.max(0, Math.min(100, ((touch.clientY - rect.top) / rect.height) * 100))
      imageRef.current.style.transformOrigin = `${x}% ${y}%`
    }

    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    return () => container.removeEventListener('touchmove', handleTouchMove)
  }, [isZoomed])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isZoomed || !containerRef.current || !imageRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
      const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
      imageRef.current.style.transformOrigin = `${x}% ${y}%`
    },
    [isZoomed],
  )

  const handleMainClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't intercept clicks on the native video controls
      if (videoRef.current && videoRef.current.contains(e.target as Node)) return

      if (isVideoActive) {
        if (videoState === 'idle') {
          // Start playback imperatively — video element is already in DOM
          if (videoRef.current) {
            videoRef.current.muted = false
            videoRef.current.play().catch(() => {
              // If unmuted play fails (autoplay policy), retry muted
              if (videoRef.current) {
                videoRef.current.muted = true
                videoRef.current.play().catch(() => {})
                setVideoState('playing-muted')
                return
              }
            })
          }
          setVideoState('playing')
        } else if (videoState === 'playing-muted') {
          // Unmute the silent autoplay
          if (videoRef.current) videoRef.current.muted = false
          setVideoState('playing')
        }
        return
      }

      if (!isZoomed && containerRef.current && imageRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * 100
        const y = ((e.clientY - rect.top) / rect.height) * 100
        imageRef.current.style.transformOrigin = `${x}% ${y}%`
      }
      setIsZoomed(z => !z)
    },
    [isZoomed, isVideoActive, videoState],
  )

  function selectMedia(i: number) {
    setLockedIndex(i)
    setPreviewIndex(null)
    setVideoState('idle')
    setVideoAspectFallback(null)
    onSelectIndex(i)
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (isZoomed) return
    touchStartX.current = e.touches[0]?.clientX ?? null
    touchStartY.current = e.touches[0]?.clientY ?? null
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (isZoomed || touchStartX.current === null || touchStartY.current === null) return
    const deltaX = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current
    const deltaY = (e.changedTouches[0]?.clientY ?? 0) - touchStartY.current
    // Only navigate if predominantly horizontal swipe > 50px
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0 && lockedIndex < items.length - 1) selectMedia(lockedIndex + 1)
      if (deltaX > 0 && lockedIndex > 0) selectMedia(lockedIndex - 1)
    }
    touchStartX.current = null
    touchStartY.current = null
  }

  const showZoomCursor = !isVideoActive && !isPlaying

  return (
    <div className="space-y-3">
      {/* Main image / video */}
      <div
        ref={containerRef}
        className={`relative rounded-[8px] overflow-hidden shadow-sm select-none aspect-square ${isPortrait && isVideoActive ? 'bg-ink' : 'bg-cream-2'}`}
      >
        {/* Video element — always mounted when a video is active so videoRef
            is available for imperative play() inside the click handler */}
        {isVideoActive && videoSrc && (
          <video
            key={displayIndex}
            ref={videoRef}
            src={videoSrc}
            controls={isPlaying}
            playsInline
            autoPlay={videoState === 'playing-muted'}
            muted={videoState === 'playing-muted'}
            preload="auto"
            onLoadedMetadata={handleVideoMetadata}
            className={`absolute inset-0 w-full h-full ${isPortrait ? 'object-contain' : 'object-cover'}`}
            style={{ zIndex: isPlaying ? 10 : 0 }}
          />
        )}

        {/* ── Not playing: show images / video preview with zoom/swipe ── */}
        {!isPlaying && (
          <div
            onClick={handleMainClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => { if (isZoomed) setIsZoomed(false) }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="absolute inset-0 z-[5]"
            style={{ cursor: showZoomCursor ? (isZoomed ? ZOOM_OUT_CURSOR : ZOOM_IN_CURSOR) : undefined }}
          >
            {/* Base layer: locked image */}
            <div
              ref={previewIndex === null || previewIndex === lockedIndex ? imageRef : undefined}
              className="absolute inset-0"
              style={{
                transform: isZoomed && (previewIndex === null || previewIndex === lockedIndex) ? 'scale(1.5)' : 'scale(1)',
                transition: 'transform 0.3s ease-out',
              }}
            >
              {items[lockedIndex]?.kind === 'video' ? (
                <>
                  <img
                    src={items[lockedIndex].previewUrl}
                    alt={alt}
                    className={`w-full h-full ${items[lockedIndex].aspect === 'portrait' ? 'object-contain' : 'object-cover'}`}
                    draggable={false}
                    fetchPriority="high"
                    decoding="async"
                  />
                  {previewIndex === null && videoState === 'idle' && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-16 h-16 rounded-full bg-white/90 shadow-lg flex items-center justify-center">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <polygon points="8,5 20,12 8,19" fill="#151211" />
                        </svg>
                      </div>
                    </div>
                  )}
                </>
              ) : items[lockedIndex]?.kind === 'image' ? (
                <img
                  src={items[lockedIndex].url}
                  alt={items[lockedIndex].altText || alt}
                  width={1200}
                  height={1200}
                  className="w-full h-full object-cover"
                  draggable={false}
                  fetchPriority="high"
                  decoding="async"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-ink/20 text-6xl">
                  &#9829;
                </div>
              )}
            </div>

            {/* Preview overlay: shown instantly during thumbnail hover */}
            {previewIndex !== null && previewIndex !== lockedIndex && items[previewIndex] && (
              <div
                ref={imageRef}
                className="absolute inset-0 z-10"
                style={{
                  transform: isZoomed ? 'scale(1.5)' : 'scale(1)',
                  transition: 'transform 0.3s ease-out',
                }}
              >
                {items[previewIndex].kind === 'video' ? (
                  <>
                    <img
                      src={items[previewIndex].previewUrl}
                      alt={alt}
                      width={1200}
                      height={1200}
                      className="w-full h-full object-cover"
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-16 h-16 rounded-full bg-white/90 shadow-lg flex items-center justify-center">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <polygon points="8,5 20,12 8,19" fill="#151211" />
                        </svg>
                      </div>
                    </div>
                  </>
                ) : (
                  <img
                    src={items[previewIndex].url}
                    alt={items[previewIndex].altText || alt}
                    width={1200}
                    height={1200}
                    className="w-full h-full object-cover"
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Muted indicator overlay */}
        {videoState === 'playing-muted' && (
          <div
            onClick={handleMainClick}
            className="absolute bottom-4 right-4 z-20 cursor-pointer"
          >
            <div className="bg-black/60 text-white text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
              Tap to unmute
            </div>
          </div>
        )}

        {/* Discount badge slot */}
        {discountBadge && <div className="z-20 pointer-events-none">{discountBadge}</div>}

        {/* Share overlay slot (upper-left) */}
        {shareOverlay && (
          <div className="absolute top-3 left-3 z-20">{shareOverlay}</div>
        )}

        {/* Heart overlay slot (self-positioned via variant="overlay") */}
        {heartOverlay && <div className="z-20">{heartOverlay}</div>}
      </div>

      {/* Mobile dot indicators */}
      {items.length > 1 && (
        <div className="flex md:hidden justify-center gap-1.5 pt-1">
          {items.slice(0, 10).map((_, i) => (
            <button
              key={i}
              onClick={() => selectMedia(i)}
              aria-label={`Go to image ${i + 1}`}
              className={[
                'rounded-full transition-all duration-200',
                lockedIndex === i
                  ? 'w-5 h-1.5 bg-coral'
                  : 'w-1.5 h-1.5 bg-ink/25',
              ].join(' ')}
            />
          ))}
        </div>
      )}

      {/* Thumbnail row with nav arrows — desktop only */}
      {items.length > 1 && (
        <div className="hidden md:block">
          <ThumbnailStrip
            items={items}
            displayIndex={displayIndex}
            onHover={setPreviewIndex}
            onSelect={selectMedia}
          />
        </div>
      )}
    </div>
  )
}

// ─── Thumbnail strip with navigation arrows ─────────────────────────────────

function ThumbnailStrip({
  items,
  displayIndex,
  onHover,
  onSelect,
}: {
  items: GalleryItem[]
  displayIndex: number
  onHover: (i: number | null) => void
  onSelect: (i: number) => void
}) {
  const thumbsRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const checkScroll = useCallback(() => {
    const el = thumbsRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    const el = thumbsRef.current
    if (!el) return
    checkScroll()
    el.addEventListener('scroll', checkScroll, { passive: true })
    const ro = new ResizeObserver(checkScroll)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect() }
  }, [checkScroll, items.length])

  function scrollThumbs(direction: 'left' | 'right') {
    const el = thumbsRef.current
    if (!el) return
    el.scrollBy({ left: direction === 'left' ? -216 : 216, behavior: 'smooth' })
  }

  return (
    <div className="relative flex items-center gap-1.5">
      {/* Left arrow */}
      <button
        type="button"
        onClick={() => scrollThumbs('left')}
        className={[
          'shrink-0 w-11 h-11 rounded-full border border-cream-2 bg-white/80 backdrop-blur flex items-center justify-center transition-all',
          canScrollLeft
            ? 'text-ink/60 hover:text-ink hover:border-ink/30'
            : 'text-ink/15 cursor-default',
        ].join(' ')}
        aria-label="Scroll thumbnails left"
        tabIndex={canScrollLeft ? 0 : -1}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* Thumbnails */}
      <div
        ref={thumbsRef}
        className="flex gap-2 overflow-x-auto scrollbar-hide scroll-smooth flex-1"
      >
        {items.slice(0, 10).map((item, i) => (
          <button
            key={i}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSelect(i)}
            className={[
              'relative shrink-0 w-16 h-16 rounded-[8px] overflow-hidden border-2 transition-all',
              displayIndex === i
                ? 'border-coral'
                : 'border-transparent opacity-60 hover:opacity-100',
            ].join(' ')}
            aria-label={item.kind === 'video' ? `Play video ${i + 1}` : `View image ${i + 1}`}
          >
            <img
              src={item.kind === 'video' ? item.previewUrl : item.url}
              alt=""
              width={64}
              height={64}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
            {item.kind === 'video' && (
              <>
                <div className="absolute inset-0 flex items-center justify-center bg-ink/30">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                </div>
                {typeof item.duration === 'number' && item.duration > 0 && (
                  <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded leading-none">
                    {formatDuration(item.duration)}
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </div>

      {/* Right arrow */}
      <button
        type="button"
        onClick={() => scrollThumbs('right')}
        className={[
          'shrink-0 w-11 h-11 rounded-full border border-cream-2 bg-white/80 backdrop-blur flex items-center justify-center transition-all',
          canScrollRight
            ? 'text-ink/60 hover:text-ink hover:border-ink/30'
            : 'text-ink/15 cursor-default',
        ].join(' ')}
        aria-label="Scroll thumbnails right"
        tabIndex={canScrollRight ? 0 : -1}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  )
}
