import type { Deal, HeroVideo, ProductVideo } from '~/types'

const PUBLISHER = {
  '@type': 'Organization',
  name:    'xdipx',
  '@id':   'https://xdipx.com/#organization',
} as const

// ISO-8601 duration. VideoObject expects e.g. "PT30S" or "PT1M30S".
function isoDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `PT${s}S`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r > 0 ? `PT${m}M${r}S` : `PT${m}M`
}

function uploadDateFor(deal: Deal): string {
  return deal.dealDate || new Date().toISOString().slice(0, 10)
}

function buildHeroVideoObject(hv: HeroVideo, deal: Deal): object | null {
  const thumbnail = hv.poster || deal.images[0]?.url
  if (!thumbnail) return null
  return {
    '@context':    'https://schema.org',
    '@type':       'VideoObject',
    name:          `${deal.seoTitle} — hero video`,
    description:   deal.tagline || deal.metaDescription || deal.seoTitle,
    thumbnailUrl:  thumbnail,
    uploadDate:    uploadDateFor(deal),
    contentUrl:    hv.src,
    duration:      isoDuration(hv.duration),
    publisher:     PUBLISHER,
  }
}

function buildProductVideoObject(v: ProductVideo, deal: Deal, idx: number): object | null {
  const source = v.sources.find(s => s.mimeType.includes('mp4')) ?? v.sources[0]
  if (!source || !v.previewImageUrl) return null
  return {
    '@context':    'https://schema.org',
    '@type':       'VideoObject',
    name:          `${deal.seoTitle} — demo ${idx + 1}`,
    description:   deal.tagline || deal.metaDescription || deal.seoTitle,
    thumbnailUrl:  v.previewImageUrl,
    uploadDate:    uploadDateFor(deal),
    contentUrl:    source.url,
    publisher:     PUBLISHER,
  }
}

export function VideoStructuredData({ deal }: { deal: Deal }) {
  const objects: object[] = []
  if (deal.heroVideo) {
    const hv = buildHeroVideoObject(deal.heroVideo, deal)
    if (hv) objects.push(hv)
  }
  deal.videos.forEach((v, i) => {
    const obj = buildProductVideoObject(v, deal, i)
    if (obj) objects.push(obj)
  })
  if (objects.length === 0) return null
  return (
    <>
      {objects.map((o, i) => (
        <script
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(o) }}
        />
      ))}
    </>
  )
}
