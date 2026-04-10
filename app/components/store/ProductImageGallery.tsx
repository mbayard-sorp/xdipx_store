import { useState, useRef, useCallback, useEffect } from 'react'

// ─── Gallery media types ──────────────────────────────────────────────────────

export type GalleryItem =
  | { kind: 'image'; url: string; altText: string }
  | { kind: 'video'; previewUrl: string; sources: { url: string; mimeType: string }[] }

interface ProductImageGalleryProps {
  items: GalleryItem[]
  alt: string
  activeIndex: number
  onSelectIndex: (i: number) => void
  discountBadge?: React.ReactNode
}

const ZOOM_IN_CURSOR = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><circle cx='12' cy='12' r='10' fill='white' stroke='%231E1A2E' stroke-width='2'/><line x1='19' y1='19' x2='28' y2='28' stroke='%231E1A2E' stroke-width='3' stroke-linecap='round'/><line x1='8' y1='12' x2='16' y2='12' stroke='%231E1A2E' stroke-width='2'/><line x1='12' y1='8' x2='12' y2='16' stroke='%231E1A2E' stroke-width='2'/></svg>") 12 12, zoom-in`

const ZOOM_OUT_CURSOR = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><circle cx='12' cy='12' r='10' fill='white' stroke='%231E1A2E' stroke-width='2'/><line x1='19' y1='19' x2='28' y2='28' stroke='%231E1A2E' stroke-width='3' stroke-linecap='round'/><line x1='8' y1='12' x2='16' y2='12' stroke='%231E1A2E' stroke-width='2'/></svg>") 12 12, zoom-out`

export function ProductImageGallery({
  items,
  alt,
  activeIndex,
  onSelectIndex,
  discountBadge,
}: ProductImageGalleryProps) {
  const [lockedIndex, setLockedIndex] = useState(activeIndex)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [isZoomed, setIsZoomed] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLDivElement>(null)

  const displayIndex = previewIndex ?? lockedIndex

  // Sync locked index when parent changes it (e.g. variant selection)
  useEffect(() => {
    setLockedIndex(activeIndex)
  }, [activeIndex])

  // Reset zoom when displayed image changes
  useEffect(() => {
    setIsZoomed(false)
    setIsPlaying(false)
    if (imageRef.current) {
      imageRef.current.style.transformOrigin = '50% 50%'
    }
  }, [displayIndex])

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
      const activeItem = items[displayIndex]

      // For videos: play instead of zoom
      if (activeItem?.kind === 'video') {
        setIsPlaying(true)
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
    [isZoomed, displayIndex, items],
  )

  function selectMedia(i: number) {
    setLockedIndex(i)
    setPreviewIndex(null)
    setIsPlaying(false)
    onSelectIndex(i)
  }

  const activeItem = items[displayIndex]
  const isVideoActive = activeItem?.kind === 'video'
  const showZoomCursor = !isVideoActive && !isPlaying

  return (
    <div className="space-y-3">
      {/* Main image / video */}
      <div
        ref={containerRef}
        onClick={!isPlaying ? handleMainClick : undefined}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { if (isZoomed) setIsZoomed(false) }}
        className="relative aspect-square rounded-2xl overflow-hidden bg-brand-mist shadow-sm select-none"
        style={{ cursor: showZoomCursor ? (isZoomed ? ZOOM_OUT_CURSOR : ZOOM_IN_CURSOR) : undefined }}
      >
        {/* Video playing state */}
        {activeItem?.kind === 'video' && isPlaying ? (
          <video
            key={activeItem.sources[0]?.url}
            controls
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          >
            {activeItem.sources.map(s => (
              <source key={s.url} src={s.url} type={s.mimeType} />
            ))}
          </video>
        ) : (
          <>
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
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                  {previewIndex === null && (
                    <div className="absolute inset-0 flex items-center justify-center group pointer-events-none">
                      <div className="w-16 h-16 rounded-full bg-white/90 shadow-lg flex items-center justify-center">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <polygon points="8,5 20,12 8,19" fill="#1E1A2E" />
                        </svg>
                      </div>
                    </div>
                  )}
                </>
              ) : items[lockedIndex]?.kind === 'image' ? (
                <img
                  src={items[lockedIndex].url}
                  alt={items[lockedIndex].altText || alt}
                  className="w-full h-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-brand-charcoal/20 text-6xl">
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
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-16 h-16 rounded-full bg-white/90 shadow-lg flex items-center justify-center">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <polygon points="8,5 20,12 8,19" fill="#1E1A2E" />
                        </svg>
                      </div>
                    </div>
                  </>
                ) : (
                  <img
                    src={items[previewIndex].url}
                    alt={items[previewIndex].altText || alt}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                )}
              </div>
            )}
          </>
        )}

        {/* Discount badge slot */}
        {discountBadge && <div className="z-20 pointer-events-none">{discountBadge}</div>}
      </div>

      {/* Thumbnail row with nav arrows */}
      {items.length > 1 && (
        <ThumbnailStrip
          items={items}
          displayIndex={displayIndex}
          onHover={setPreviewIndex}
          onSelect={selectMedia}
        />
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
          'shrink-0 w-11 h-11 rounded-full border border-brand-mist bg-white/80 backdrop-blur flex items-center justify-center transition-all',
          canScrollLeft
            ? 'text-brand-charcoal/60 hover:text-brand-charcoal hover:border-brand-charcoal/30'
            : 'text-brand-charcoal/15 cursor-default',
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
              'relative shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all',
              displayIndex === i
                ? 'border-brand-coral'
                : 'border-transparent opacity-60 hover:opacity-100',
            ].join(' ')}
            aria-label={item.kind === 'video' ? `Play video ${i + 1}` : `View image ${i + 1}`}
          >
            <img
              src={item.kind === 'video' ? item.previewUrl : item.url}
              alt=""
              width={64}
              height={64}
              className="w-full h-full object-cover"
            />
            {item.kind === 'video' && (
              <div className="absolute inset-0 flex items-center justify-center bg-brand-charcoal/30">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Right arrow */}
      <button
        type="button"
        onClick={() => scrollThumbs('right')}
        className={[
          'shrink-0 w-11 h-11 rounded-full border border-brand-mist bg-white/80 backdrop-blur flex items-center justify-center transition-all',
          canScrollRight
            ? 'text-brand-charcoal/60 hover:text-brand-charcoal hover:border-brand-charcoal/30'
            : 'text-brand-charcoal/15 cursor-default',
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
