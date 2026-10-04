/**
 * Aspect-true media well for one creative (wires 5.2). The well declares its
 * aspect in CSS and the <img> carries width and height, so nothing shifts when
 * the image loads. object-contain everywhere: the owner rates exactly the
 * pixels that would ship. Banners show at native size when the column allows,
 * never upscale, and get a "View at 1:1" button that opens BannerViewer.
 */
import { useState } from 'react'
import { getAdFormat } from '~/lib/ad-formats'
import type { CreativeListItem } from '~/lib/ad-creative-types'
import { BannerViewer } from './BannerViewer'

export type ImgPriority = 'high' | 'eager' | 'lazy'

export function CreativeMedia({ item, priority }: { item: CreativeListItem; priority: ImgPriority }) {
  const [viewer, setViewer] = useState(false)
  const fmt = getAdFormat(item.format)

  // Search text creative: no image, headlines only.
  if (item.format === 'text') {
    return (
      <div className="bg-paper-3 px-4 py-5">
        <p className="kicker mb-2">Search headlines</p>
        <ul className="space-y-1">
          {item.headlines.slice(0, 6).map(h => (
            <li key={h} className={`text-sm ${h.length > 30 ? 'text-amber-800' : 'text-ink'}`}>
              {h} <span className="font-mono text-[10px] text-ink-4">{h.length}/30</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const wellClass = fmt?.wellClass ?? 'aspect-square w-full'
  const family = fmt?.family ?? 'square'
  const band = family === 'banner' || family === 'story'
  const chipText = item.format.includes('x') ? item.format : `${item.format} · ${item.width ?? fmt?.width}x${item.height ?? fmt?.height}`
  // Small wells keep the chip above the image so it never covers the type.
  const chip = band ? null : (
    <span className="absolute right-2 top-2 z-10 rounded bg-ink/70 px-1.5 py-0.5 font-mono text-[10px] leading-4 text-white">{chipText}</span>
  )

  const img = item.assetUrl ? (
    <img
      src={item.assetUrl}
      width={item.width ?? fmt?.width}
      height={item.height ?? fmt?.height}
      alt={item.slogan ? `Ad creative: ${item.slogan}` : 'Ad creative'}
      loading={priority === 'lazy' ? 'lazy' : 'eager'}
      {...(priority === 'high' ? { fetchPriority: 'high' as const } : {})}
      decoding="async"
      className="absolute inset-0 h-full w-full object-contain"
    />
  ) : (
    <div className="absolute inset-0 flex items-center justify-center text-xs text-ink-4">
      {item.status === 'rendering' ? 'Rendering' : item.status === 'failed' ? 'Render failed' : 'Queued for the next render pass'}
    </div>
  )

  const well = <div className={`relative bg-paper-3 ${wellClass}`}>{chip}{img}</div>
  const native = fmt && fmt.family === 'banner' && fmt.width > 340

  return (
    <div>
      {band ? (
        <div className="bg-paper-3 py-4 px-4">
          <p className="mb-2 font-mono text-[10px] text-ink-3">{chipText}</p>
          {well}
        </div>
      ) : well}
      {native && item.assetUrl && (
        <div className="px-4">
          <button
            type="button"
            onClick={() => setViewer(true)}
            className="min-h-11 text-sm font-medium text-ink underline-offset-2 hover:underline touch-manipulation"
          >
            View at 1:1
          </button>
        </div>
      )}
      {viewer && item.assetUrl && fmt && (
        <BannerViewer src={item.assetUrl} width={fmt.width} height={fmt.height} label={fmt.label} onClose={() => setViewer(false)} />
      )}
    </div>
  )
}
