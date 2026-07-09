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
import type { FaqSection } from '~/lib/faq-content'

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

// ─── HTML to Markdown ────────────────────────────────────────────────────────

/**
 * Convert the limited HTML subset emitted by ptToHtml() (and legacy Shopify
 * metafields) into plain markdown. No external dependencies.
 *
 * Handles: <p>, <br>, <strong>/<b>, <em>/<i>, <ul>/<ol>/<li>, <h2>-<h4>,
 * <a href>, plus entity decoding. Strips any other tags.
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return ''

  let md = html

  // Decode common HTML entities first
  md = md
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&nbsp;/g, ' ')

  // Headings (before stripping tags)
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n')
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n')
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n')

  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')

  // Bold
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')

  // Italic
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')

  // List items (capture before removing ul/ol wrappers)
  // Ordered lists: wrap items with a counter. Process each <ol> block separately.
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_match, inner: string) => {
    let counter = 0
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, content: string) => {
      counter++
      return `\n${counter}. ${content.replace(/<[^>]+>/g, '').trim()}`
    }) + '\n'
  })

  // Unordered lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_match, inner: string) => {
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, content: string) => {
      return `\n- ${content.replace(/<[^>]+>/g, '').trim()}`
    }) + '\n'
  })

  // Paragraphs and line breaks
  md = md.replace(/<\/p>/gi, '\n\n')
  md = md.replace(/<p[^>]*>/gi, '')
  md = md.replace(/<br\s*\/?>/gi, '\n')

  // Strip any remaining tags
  md = md.replace(/<[^>]+>/g, '')

  // Collapse 3+ consecutive newlines to 2
  md = md.replace(/\n{3,}/g, '\n\n')

  return md.trim()
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
type PtProductEmbed = { _type: 'blogProductEmbed'; productHandle?: string; ctaLabel?: string }
type PtPullQuote = { _type: 'blogPullQuote'; quote?: string; attribution?: string }
type PtVideoEmbed = { _type: 'blogVideoEmbed'; url?: string; caption?: string }
type PtNode = PtBlock | PtImage | PtBlogImage | PtProductEmbed | PtPullQuote | PtVideoEmbed | { _type: string; [k: string]: unknown }

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

  // Product picks must survive on the .md surface (guides' ItemList source).
  // No price here: prices live on the PDP, and stale ones would violate MAP.
  if (node._type === 'blogProductEmbed') {
    const embed = node as PtProductEmbed
    if (!embed.productHandle) return ''
    const label = embed.ctaLabel?.trim() || 'Take a peek'
    return `**Product pick:** [${label}](${BASE_URL}/products/${embed.productHandle})`
  }

  if (node._type === 'blogPullQuote') {
    const pq = node as PtPullQuote
    if (!pq.quote?.trim()) return ''
    const attribution = pq.attribution?.trim()
    return attribution ? `> ${pq.quote}\n> (${attribution})` : `> ${pq.quote}`
  }

  if (node._type === 'blogVideoEmbed') {
    const video = node as PtVideoEmbed
    if (!video.url) return ''
    return `[${video.caption?.trim() || 'Watch the video'}](${video.url})`
  }

  // blogCta and anything else unknown — omit silently
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
    lines.push(htmlToMarkdown(deal.fullStory))
    lines.push('')
  }

  // Works for him / her
  if (deal.worksForHim) {
    lines.push('## Works for him')
    lines.push('')
    lines.push(htmlToMarkdown(deal.worksForHim))
    lines.push('')
  }
  if (deal.worksForHer) {
    lines.push('## Works for her')
    lines.push('')
    lines.push(htmlToMarkdown(deal.worksForHer))
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
  /** Emma-voice explainer from Sanity collectionPage.introCopy (already markdown). Takes priority over description. */
  introMarkdown?: string | undefined
  faqs?: Array<{ question: string; answer: string }> | undefined
  products: CollectionItem[]
}

export function collectionToMarkdown(col: CollectionData): string {
  const path = `/collections/${col.handle}`
  const lines: string[] = []

  lines.push(`# ${col.title}`)
  lines.push('')

  if (col.introMarkdown) {
    lines.push(col.introMarkdown)
    lines.push('')
  } else if (col.description) {
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

  if (col.faqs && col.faqs.length > 0) {
    lines.push('## Frequently asked questions')
    lines.push('')
    for (const f of col.faqs) {
      lines.push(`### ${f.question}`)
      lines.push('')
      lines.push(f.answer)
      lines.push('')
    }
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

/**
 * Serialize a Sanity page's content-block sections. Handles the text-bearing
 * block types (richText bodies, the editorBio card) plus raw portable-text
 * nodes; layout-only blocks (carousels, tiles, banners) are omitted.
 */
function contentSectionsToMarkdown(sections: unknown): string {
  if (!Array.isArray(sections)) return ''

  type EditorLike = {
    name?: string | null
    role?: string | null
    shortBio?: string | null
    longBio?: unknown
  }

  const parts: string[] = []
  for (const raw of sections) {
    if (!raw || typeof raw !== 'object') continue
    const node = raw as { _type?: string; active?: boolean; body?: unknown; editor?: EditorLike | null }
    if (node.active === false) continue

    if (node._type === 'richText') {
      const md = portableTextToMarkdown(node.body)
      if (md) parts.push(md)
      continue
    }

    if (node._type === 'editorBio') {
      const editor = node.editor
      if (!editor?.name) continue
      const bio: string[] = [`## ${editor.name}`]
      if (editor.role) bio.push('', editor.role)
      if (editor.shortBio) bio.push('', editor.shortBio)
      const longBio = portableTextToMarkdown(editor.longBio)
      if (longBio) bio.push('', longBio)
      parts.push(bio.join('\n'))
      continue
    }

    // Raw portable-text nodes (block / image), for pages stored as plain PT
    const md = blockToMarkdown(node as PtNode)
    if (md) parts.push(md)
  }
  return parts.join('\n\n')
}

export interface PageData {
  slug: string
  title: string
  sections?: unknown
  /** Optional intro rendered as a blockquote under the H1 (e.g. the page's SEO description). */
  description?: string | undefined
  /** Clean canonical path override (e.g. '/about'). Defaults to /pages/{slug}. */
  canonicalPath?: string | undefined
}

export function pageToMarkdown(page: PageData): string {
  const path = page.canonicalPath ?? `/pages/${page.slug}`
  const lines: string[] = []

  lines.push(`# ${page.title}`)
  lines.push('')

  if (page.description) {
    lines.push(`> ${page.description}`)
    lines.push('')
  }

  if (page.sections) {
    const bodyMd = contentSectionsToMarkdown(page.sections)
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
    '> xdipx is an editorially curated sexual wellness storefront. ' +
    'Emma, our guide, hand-picks products and advises on how each one works ' +
    'and who it suits. Discreet shipping and billing throughout the United States.',
  )
  lines.push('')

  lines.push('## Shop')
  lines.push('')
  lines.push(`- [Discover (guided product finder)](${BASE_URL}/discover)`)
  lines.push(`- [Collections](${BASE_URL}/collections)`)
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
  }

  lines.push('## More')
  lines.push('')
  lines.push(`- [Notebook](${BASE_URL}/notebook)`)
  lines.push(`- [All products (markdown index)](${BASE_URL}/index.md)`)
  lines.push('')

  lines.push(mdFooter(path))

  return lines.join('\n')
}

// ─── faqToMarkdown ───────────────────────────────────────────────────────────

export function faqToMarkdown(sections: FaqSection[]): string {
  const path = '/faq'
  const lines: string[] = []

  lines.push('# xdipx FAQ')
  lines.push('')
  lines.push('> Questions about shipping, billing, returns, and xdipx. We answer everything.')
  lines.push('')

  for (const section of sections) {
    lines.push(`## ${section.heading}`)
    lines.push('')
    for (const item of section.items) {
      lines.push(`### ${item.q}`)
      lines.push('')
      lines.push(item.a)
      lines.push('')
    }
  }

  lines.push('Still have a question? Email hello@xdipx.com. We respond fast.')
  lines.push('')

  lines.push(mdFooter(path))

  return lines.join('\n')
}

// ─── discoverToMarkdown ──────────────────────────────────────────────────────

export interface DiscoverProductItem {
  handle: string
  title: string
  /** Lowest variant price ("from" price). */
  price: number
  priceMax?: number | null | undefined
}

export interface DiscoverGroup {
  tag: string
  total: number
  products: DiscoverProductItem[]
}

export interface DiscoverData {
  moods: DiscoverGroup[]
  audiences: DiscoverGroup[]
  matters: DiscoverGroup[]
}

function discoverProductLine(p: DiscoverProductItem): string {
  const from = p.priceMax != null && p.priceMax > p.price ? 'from ' : ''
  return `- [${p.title}](${BASE_URL}/products/${p.handle}): ${from}$${p.price.toFixed(2)}`
}

function discoverGroupSection(lines: string[], heading: string, intro: string, groups: DiscoverGroup[]): void {
  if (groups.length === 0) return
  lines.push(`## ${heading}`)
  lines.push('')
  lines.push(intro)
  lines.push('')
  for (const g of groups) {
    lines.push(`### ${g.tag} (${g.total} ${g.total === 1 ? 'product' : 'products'})`)
    lines.push('')
    for (const p of g.products) lines.push(discoverProductLine(p))
    if (g.total > g.products.length) {
      lines.push(`- Plus ${g.total - g.products.length} more in the finder: ${BASE_URL}/discover`)
    }
    lines.push('')
  }
}

export function discoverToMarkdown(data: DiscoverData): string {
  const path = '/discover'
  const lines: string[] = []

  lines.push('# Find your fit, the xdipx product finder')
  lines.push('')
  lines.push(
    '> The Compass is xdipx\'s guided product finder. Pick a mood, who it\'s for, ' +
    'and what matters to you, and the shelf reshapes around your answers. ' +
    'This page lists the same catalog grouped by those filters, ' +
    'with links to each product\'s canonical page.',
  )
  lines.push('')
  lines.push(`Interactive version: ${BASE_URL}/discover`)
  lines.push('')

  discoverGroupSection(lines, 'Browse by mood', 'The mood or occasion a product suits.', data.moods)
  discoverGroupSection(lines, 'Browse by who it\'s for', 'Who the product is designed around.', data.audiences)
  discoverGroupSection(lines, 'Browse by what matters', 'Practical priorities like quietness, size, or ease of cleaning.', data.matters)

  lines.push(mdFooter(path))

  return lines.join('\n')
}

// ─── notebookHubToMarkdown ───────────────────────────────────────────────────

export interface NotebookHubPost {
  slug: string
  title: string
  excerpt?: string | null | undefined
  publishedAt?: string | null | undefined
  category?: { name?: string | null | undefined } | null | undefined
}

export interface NotebookHubCategory {
  slug: string
  name: string
  description?: string | null | undefined
}

export interface NotebookHubData {
  posts: NotebookHubPost[]
  total: number
  categories: NotebookHubCategory[]
}

export function notebookHubToMarkdown(hub: NotebookHubData): string {
  const path = '/notebook'
  const lines: string[] = []

  lines.push('# The Notebook')
  lines.push('')
  lines.push(
    '> The xdipx editorial notebook. Things worth knowing, things worth trying, ' +
    'things Emma couldn\'t stop thinking about.',
  )
  lines.push('')

  if (hub.posts.length > 0) {
    lines.push('## Posts')
    lines.push('')
    for (const p of hub.posts) {
      const metaParts: string[] = []
      const date = p.publishedAt?.split('T')[0]
      if (date) metaParts.push(date)
      if (p.category?.name) metaParts.push(p.category.name)
      const metaStr = metaParts.length > 0 ? ` (${metaParts.join(', ')})` : ''
      const excerpt = p.excerpt?.trim() ? `: ${p.excerpt.trim()}` : ''
      lines.push(`- [${p.title}](${BASE_URL}/notebook/${p.slug})${metaStr}${excerpt}`)
    }
    lines.push('')
    if (hub.total > hub.posts.length) {
      lines.push(`Showing the ${hub.posts.length} most recent of ${hub.total} posts. Full archive: ${BASE_URL}/notebook`)
      lines.push('')
    }
    lines.push('Each post also has a markdown version at the same URL with ".md" appended.')
    lines.push('')
  } else {
    lines.push('No posts published yet. New writing lands here first.')
    lines.push('')
  }

  if (hub.categories.length > 0) {
    lines.push('## Categories')
    lines.push('')
    for (const c of hub.categories) {
      const desc = c.description?.trim() ? `: ${c.description.trim()}` : ''
      lines.push(`- [${c.name}](${BASE_URL}/notebook/category/${c.slug})${desc}`)
    }
    lines.push('')
  }

  lines.push(mdFooter(path))

  return lines.join('\n')
}
