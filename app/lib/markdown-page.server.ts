/**
 * Serializers that turn data-layer objects into plain markdown for AEO/LLM surfaces.
 *
 * Rules:
 * - No YAML frontmatter. Plain markdown only.
 * - No em dashes. Use periods or commas.
 * - Emma voice: never imply Emma used/tried/owned a product.
 * - No countdowns or "until midnight" language.
 * - No "sex" as adjective. Use "intimate", "pleasure", "wellness", "satisfaction".
 * - Footer is always the same block (mdFooter).
 */

import type { Deal } from '~/types'

// ─── Shared utilities ────────────────────────────────────────────────────────

/** Escape markdown special characters in inline text. */
export function mdEscape(text: string): string {
  return text.replace(/([[\]()\\`*_{}#+\-.!>|])/g, '\\$1')
}

const BASE_URL = 'https://xdipx.com'

const FOOTER_BRAND =
  'xdipx.com is an editorially curated sexual wellness storefront. ' +
  'Support: hello@xdipx.com. Billing descriptor: XDIPX.'

function mdFooter(canonicalPath: string): string {
  const today = new Date().toISOString().split('T')[0]!
  return [
    '---',
    `Canonical: ${BASE_URL}${canonicalPath}`,
    `Last updated: ${today}`,
    FOOTER_BRAND,
    '',
  ].join('\n')
}

// ─── Portable Text to Markdown ───────────────────────────────────────────────

type PtSpan = { _type: 'span'; text: string; marks?: string[] }
type PtImage = { _type: 'image'; asset?: { url?: string }; alt?: string }
type PtBlogImage = { _type: 'blogImage'; image?: { url?: string; alt?: string } }
type PtBlock = {
  _type: 'block'
  style?: string
  listItem?: string
  children?: PtSpan[]
  markDefs?: { _key: string; _type: string; href?: string }[]
}
type PtNode = PtBlock | PtImage | PtBlogImage | { _type: string; [k: string]: unknown }

function inlineText(span: PtSpan, markDefs?: { _key: string; _type: string; href?: string }[]): string {
  let text = span.text ?? ''
  const marks = span.marks ?? []
  for (const mark of marks) {
    // Bold
    if (mark === 'strong') { text = `**${text}**`; continue }
    // Italic
    if (mark === 'em') { text = `*${text}*`; continue }
    // Link — look up in markDefs
    const def = markDefs?.find(d => d._key === mark)
    if (def?._type === 'link' && def.href) {
      text = `[${text}](${def.href})`
    }
  }
  return text
}

function blockToMarkdown(node: PtNode): string {
  if (node._type === 'block') {
    const block = node as PtBlock
    const children = block.children ?? []
    const text = children.map(c => inlineText(c, block.markDefs)).join('')

    if (!text.trim()) return ''

    if (block.listItem === 'bullet') return `- ${text}`
    if (block.listItem === 'number') return `1. ${text}`

    const style = block.style ?? 'normal'
    if (style === 'h2') return `## ${text}`
    if (style === 'h3') return `### ${text}`
    if (style === 'h4') return `#### ${text}`
    if (style === 'blockquote') return `> ${text}`
    // normal / any other style
    return text
  }

  if (node._type === 'image') {
    const img = node as PtImage
    const url = img.asset?.url
    if (!url) return ''
    const alt = img.alt ?? ''
    return `![${alt}](${url})`
  }

  if (node._type === 'blogImage') {
    const img = node as PtBlogImage
    const url = img.image?.url
    if (!url) return ''
    const alt = img.image?.alt ?? ''
    return `![${alt}](${url})`
  }

  // Unknown block type — omit silently
  return ''
}

function portableTextToMarkdown(body: unknown): string {
  if (!Array.isArray(body)) return ''

  const lines: string[] = []
  for (const node of body as PtNode[]) {
    const line = blockToMarkdown(node)
    if (line) lines.push(line)
  }

  // Collapse consecutive list items but insert blank lines between non-list paragraphs
  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    result.push(line)
    // Add blank line after paragraphs (not after list items, to avoid breaking lists)
    const next = lines[i + 1]
    if (next !== undefined && !line.startsWith('- ') && !line.startsWith('1. ') && !next.startsWith('- ') && !next.startsWith('1. ')) {
      result.push('')
    }
  }
  return result.join('\n')
}

// ─── productToMarkdown ───────────────────────────────────────────────────────

export interface ProductMarkdownOpts {
  /** ISO date string for last-updated footer */
  updatedAt?: string
}

export function productToMarkdown(deal: Deal, _opts: ProductMarkdownOpts = {}): string {
  const path = `/products/${deal.handle}`
  const lines: string[] = []

  // H1
  lines.push(`# ${deal.seoTitle}`)
  lines.push('')

  // Factual answer block (BEFORE editorial voice)
  lines.push('## What it is')
  lines.push('')
  const availability = deal.qty > 0 ? 'In stock.' : 'Currently unavailable.'
  const priceStr = deal.mapRestricted
    ? `$${deal.dealPrice.toFixed(2)}`
    : deal.msrp > deal.dealPrice
      ? `$${deal.dealPrice.toFixed(2)} (retail value $${deal.msrp.toFixed(2)})`
      : `$${deal.dealPrice.toFixed(2)}`

  const category = Array.isArray(deal.category) && deal.category.length > 0
    ? deal.category.join(' and ')
    : null
  const forLine = category ? ` Positioned for ${category}.` : ''

  lines.push(
    `The ${deal.seoTitle} is a ${deal.brand ? `${deal.brand} ` : ''}wellness product.${forLine} Current price: ${priceStr}. ${availability}`,
  )
  lines.push('')

  // Emma editorial
  if (deal.tagline) {
    lines.push('## Emma\'s take')
    lines.push('')
    lines.push(deal.tagline)
    lines.push('')
  }

  if (deal.fullStory) {
    lines.push(deal.fullStory)
    lines.push('')
  }

  // Works for him / her
  if (deal.worksForHim) {
    lines.push('## Works for him')
    lines.push('')
    lines.push(deal.worksForHim)
    lines.push('')
  }
  if (deal.worksForHer) {
    lines.push('## Works for her')
    lines.push('')
    lines.push(deal.worksForHer)
    lines.push('')
  }

  // Specs
  if (deal.specifications && deal.specifications.length > 0) {
    lines.push('## Specifications')
    lines.push('')
    for (const s of deal.specifications) lines.push(`- ${s}`)
    lines.push('')
  }

  // Box contents
  if (deal.boxContents && deal.boxContents.length > 0) {
    lines.push('## What\'s in the box')
    lines.push('')
    for (const item of deal.boxContents) lines.push(`- ${item}`)
    lines.push('')
  }

  // Care
  if (deal.careInstructions && deal.careInstructions.length > 0) {
    lines.push('## Care instructions')
    lines.push('')
    for (const step of deal.careInstructions) lines.push(`- ${step}`)
    lines.push('')
  }

  // Footer
  lines.push(mdFooter(path))

  return lines.join('\n')
}

// ─── collectionToMarkdown ────────────────────────────────────────────────────

export interface CollectionItem {
  handle: string
  title: string
  tagline?: string | undefined
  price?: number | undefined
}

export interface CollectionData {
  handle: string
  title: string
  description?: string | undefined
  products: CollectionItem[]
}

export function collectionToMarkdown(col: CollectionData): string {
  const path = `/collections/${col.handle}`
  const lines: string[] = []

  lines.push(`# ${col.title}`)
  lines.push('')

  if (col.description) {
    lines.push(col.description)
    lines.push('')
  }

  if (col.products.length > 0) {
    lines.push('## Products in this collection')
    lines.push('')
    for (const p of col.products) {
      const desc = p.tagline ? `: ${p.tagline}` : p.price ? `: from $${p.price.toFixed(2)}` : ''
      lines.push(`- [${p.title}](${BASE_URL}/products/${p.handle})${desc}`)
    }
    lines.push('')
  }

  lines.push(mdFooter(path))

  return lines.join('\n')
}

// ─── blogPostToMarkdown ──────────────────────────────────────────────────────

export interface BlogPostData {
  slug: string
  title: string
  excerpt?: string | undefined
  body?: unknown
  publishedAt?: string | undefined
  author?: { name?: string | null | undefined } | undefined
  category?: { name?: string | null | undefined } | undefined
}

export function blogPostToMarkdown(post: BlogPostData): string {
  const path = `/notebook/${post.slug}`
  const lines: string[] = []

  lines.push(`# ${post.title}`)
  lines.push('')

  if (post.author?.name || post.category?.name) {
    const byParts: string[] = []
    if (post.author?.name) byParts.push(`By ${post.author.name}`)
    if (post.category?.name) byParts.push(post.category.name)
    if (post.publishedAt) byParts.push(post.publishedAt.split('T')[0]!)
    lines.push(byParts.join(' · '))
    lines.push('')
  }

  if (post.excerpt) {
    lines.push(post.excerpt)
    lines.push('')
  }

  if (post.body) {
    const bodyMd = portableTextToMarkdown(post.body)
    if (bodyMd) {
      lines.push(bodyMd)
      lines.push('')
    }
  }

  lines.push(mdFooter(path))

  return lines.join('\n')
}

// ─── pageToMarkdown ──────────────────────────────────────────────────────────

export interface PageData {
  slug: string
  title: string
  sections?: unknown
}

export function pageToMarkdown(page: PageData): string {
  const path = `/pages/${page.slug}`
  const lines: string[] = []

  lines.push(`# ${page.title}`)
  lines.push('')

  if (page.sections) {
    const bodyMd = portableTextToMarkdown(page.sections)
    if (bodyMd) {
      lines.push(bodyMd)
      lines.push('')
    }
  }

  lines.push(mdFooter(path))

  return lines.join('\n')
}

// ─── homepageToMarkdown ──────────────────────────────────────────────────────

export function homepageToMarkdown(deal: Deal | null): string {
  const path = '/'
  const lines: string[] = []

  lines.push('# xdipx.com')
  lines.push('')
  lines.push(
    '> xdipx is an editorially curated storefront for adult wellness and intimacy products. ' +
    'Emma, our guide, features a hand-picked product on an irregular cadence. ' +
    'Discreet shipping and billing throughout the United States.',
  )
  lines.push('')

  if (deal) {
    lines.push("## Emma's current pick")
    lines.push('')

    const availability = deal.qty > 0 ? 'In stock.' : 'Currently unavailable.'
    const priceStr = deal.mapRestricted
      ? `$${deal.dealPrice.toFixed(2)}`
      : deal.msrp > deal.dealPrice
        ? `$${deal.dealPrice.toFixed(2)} (retail value $${deal.msrp.toFixed(2)})`
        : `$${deal.dealPrice.toFixed(2)}`

    lines.push(`**[${deal.seoTitle}](${BASE_URL}/products/${deal.handle})** by ${deal.brand || 'xdipx'}`)
    lines.push('')
    lines.push(`${priceStr}. ${availability}`)
    lines.push('')
    if (deal.tagline) {
      lines.push(deal.tagline)
      lines.push('')
    }
    lines.push(`Full details: ${BASE_URL}/products/${deal.handle}.md`)
    lines.push('')
  } else {
    lines.push("## Emma's current pick")
    lines.push('')
    lines.push('No active pick at this time. Check back soon.')
    lines.push('')
  }

  lines.push('## Explore')
  lines.push('')
  lines.push(`- [The Shelf (archive)](${BASE_URL}/vault)`)
  lines.push(`- [Collections](${BASE_URL}/collections)`)
  lines.push(`- [Notebook](${BASE_URL}/notebook)`)
  lines.push(`- [All products (markdown index)](${BASE_URL}/index.md)`)
  lines.push('')

  lines.push(mdFooter(path))

  return lines.join('\n')
}
