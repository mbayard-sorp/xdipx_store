import type { MetaDescriptor } from 'react-router'
import { BRAND_TITLE } from '~/lib/brand'

export const SITE_ORIGIN =
  (typeof process !== 'undefined' && process.env?.['SITE_ORIGIN']) || 'https://xdipx.com'

const DEFAULT_OG_IMAGE = 'https://xdipx.com/og/og-default.png'

export function ogImageUrl(
  url: string | undefined | null,
  opts: { w?: number; h?: number } = {},
): string {
  if (!url) return ''
  const w = opts.w ?? 1200
  const h = opts.h ?? 630
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}width=${w}&height=${h}&crop=center`
}

interface BuildSocialMetaInput {
  title: string
  description: string
  url: string
  image: string | null
  type?: 'website' | 'product' | 'article' | 'profile'
  siteName?: string
  twitterHandle?: string
  imageAlt?: string
}

export function buildSocialMeta({
  title,
  description,
  url,
  image,
  type = 'website',
  siteName = 'xdipx',
  twitterHandle = '@xdipx',
  imageAlt,
}: BuildSocialMetaInput): MetaDescriptor[] {
  // For the static fallback OG image we skip resize query params (it's a
  // fixed 1200×630 PNG; adding ?width= just pollutes the URL).
  const sized = image ? ogImageUrl(image) : DEFAULT_OG_IMAGE
  const alt = imageAlt ?? title ?? BRAND_TITLE

  const tags: MetaDescriptor[] = [
    { property: 'og:title',       content: title },
    { property: 'og:description', content: description },
    { property: 'og:type',        content: type },
    { property: 'og:url',         content: url },
    { property: 'og:site_name',   content: siteName },
    { name: 'twitter:card',        content: 'summary_large_image' },
    { name: 'twitter:site',        content: twitterHandle },
    { name: 'twitter:title',       content: title },
    { name: 'twitter:description', content: description },
  ]

  tags.push(
    { property: 'og:image',        content: sized },
    { property: 'og:image:width',  content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt',    content: alt },
    { name: 'twitter:image',       content: sized },
    { name: 'twitter:image:alt',   content: alt },
  )

  return tags
}
