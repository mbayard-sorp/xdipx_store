import { PortableText } from '@portabletext/react'
import { Link } from 'react-router'
import { createContext, useContext } from 'react'
import type { Product } from '~/types'
import { Reveal } from '~/components/motion/Reveal'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { SanityImage } from '~/components/common/SanityImage'

// ── Product context for blogProductEmbed blocks ──────────────────────────

const ProductMapContext = createContext<Record<string, Product>>({})

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function blockText(block: any): string {
  return (block?.children ?? []).map((c: any) => c.text ?? '').join('')
}

// ── Custom block components ──────────────────────────────────────────────

function BodyImage({ image, alt, className = '' }: { image: any; alt: string; className?: string }) {
  return (
    <SanityImage
      src={image.url}
      alt={alt}
      sizes="(max-width: 768px) 100vw, 720px"
      widths={[400, 640, 828, 1200]}
      fallbackWidth={828}
      {...(image.width ? { width: image.width } : {})}
      {...(image.height ? { height: image.height } : {})}
      {...(image.lqip ? { lqip: image.lqip } : {})}
      className={`rounded-lg w-full ${className}`}
    />
  )
}

function BlogImageBlock({ value }: { value: any }) {
  const layout = value.layout ?? 'full-width'
  if (!value.image?.url) return null

  if (layout === 'side-by-side') {
    return (
      <figure className="my-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <BodyImage image={value.image} alt={value.alt ?? ''} />
          {value.caption && <figcaption className="text-[13px] text-ink-3 mt-2">{value.caption}</figcaption>}
        </div>
        {value.secondImage?.url && (
          <div>
            <BodyImage image={value.secondImage} alt={value.secondAlt ?? ''} />
            {value.secondCaption && <figcaption className="text-[13px] text-ink-3 mt-2">{value.secondCaption}</figcaption>}
          </div>
        )}
      </figure>
    )
  }

  const layoutClasses =
    layout === 'left-float'  ? 'sm:float-left sm:mr-6 sm:mb-4 sm:w-1/2' :
    layout === 'right-float' ? 'sm:float-right sm:ml-6 sm:mb-4 sm:w-1/2' :
    'max-w-none -mx-4 sm:mx-0'

  return (
    <figure className={`my-8 ${layoutClasses}`}>
      <BodyImage image={value.image} alt={value.alt ?? ''} />
      {value.caption && (
        <figcaption className="text-[13px] text-ink-3 mt-2 px-4 sm:px-0">{value.caption}</figcaption>
      )}
    </figure>
  )
}

/**
 * Pull quote as a hanging margin aside (art direction §4): at ≥1280px it
 * floats into the right margin so body text wraps to its left; below that it
 * renders inline full-width. Italic plum with a coral tick, no quote glyphs.
 */
function BlogPullQuoteBlock({ value }: { value: any }) {
  return (
    <Reveal variant="fade" as="aside" className="my-7 xl:my-0 xl:float-right xl:w-[220px] xl:-mr-[240px] xl:pl-0 pl-4 border-l-2 border-coral xl:border-l-0">
      <span className="hidden xl:block w-6 h-0.5 bg-coral mb-3" aria-hidden="true" />
      <p
        className="text-xl xl:text-2xl leading-[1.3] italic text-plum"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
      >
        {value.quote}
      </p>
      {value.attribution && <cite className="kicker not-italic block mt-2">{value.attribution}</cite>}
    </Reveal>
  )
}

/**
 * "Featured in this piece" editorial embed (art direction §4). Reads as a
 * citation, not a banner ad: paper card, kicker eyebrow, hairline CTA, one
 * coral tick. Only the title and CTA are links.
 */
function BlogProductEmbedBlock({ value }: { value: any }) {
  const productMap = useContext(ProductMapContext)
  const product = productMap[value.productHandle]
  const ctaLabel = value.ctaLabel ?? 'Take a peek →'
  const href = `/products/${value.productHandle}`

  if (!product) {
    return (
      <div className="my-7 p-4 bg-paper-2 rounded-lg text-center text-sm text-ink-3">
        <Link to={href} className="link-coral text-coral">{ctaLabel}</Link>
      </div>
    )
  }

  const whyLine = product.metaDescription
    ? product.metaDescription.length > 120
      ? `${product.metaDescription.slice(0, 117).trimEnd()}…`
      : product.metaDescription
    : null
  const specLine = [product.brand, product.category].filter(Boolean).join(' · ')

  return (
    <Reveal variant="up" className="my-7 relative bg-paper border border-line rounded-lg p-5 md:p-6 overflow-hidden">
      <span className="absolute right-0 top-0 bottom-0 w-0.5 bg-coral" aria-hidden="true" />
      <p className="kicker mb-3">Featured in this piece</p>
      <div className="flex flex-col sm:flex-row gap-4">
        {product.images[0] && (
          <div className="w-[88px] h-[88px] rounded-[14px] bg-paper-3 overflow-hidden shrink-0">
            <OptimizedImage
              src={product.images[0].url}
              alt={product.title}
              widths={[176, 264]}
              fallbackWidth={176}
              sizes="88px"
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <div className="min-w-0">
          <Link
            to={href}
            className="text-ink hover:text-coral transition-colors text-lg md:text-xl leading-snug"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
          >
            {product.title}
          </Link>
          {whyLine && (
            <p
              className="text-ink-2 text-base leading-[1.55] mt-1"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
            >
              {whyLine}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5">
            {specLine && <span className="text-[13px] text-ink-3">{specLine}</span>}
            <Link to={href} className="link-coral text-coral text-sm font-medium">
              {ctaLabel}
            </Link>
          </div>
        </div>
      </div>
    </Reveal>
  )
}

function BlogCtaBlock({ value }: { value: any }) {
  const bgStyle = value.bgStyle ?? 'gradient'
  // Legacy bgStyle values mapped onto the v3 palette: soft washes, calm type,
  // never a white-on-coral banner.
  const bgClass =
    bgStyle === 'gradient'  ? 'bg-coral-soft text-ink' :
    bgStyle === 'purple'    ? 'bg-plum-soft text-ink' :
    bgStyle === 'mist'      ? 'bg-paper-2 text-ink' :
    bgStyle === 'cream'     ? 'bg-paper-3 text-ink' :
    'bg-ink text-white'
  const isDark = bgStyle === 'charcoal'

  return (
    <Reveal variant="up" className={`my-7 rounded-lg p-6 md:p-8 text-center ${bgClass}`}>
      {value.heading && (
        <p className="text-xl md:text-2xl mb-2" style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}>
          {value.heading}
        </p>
      )}
      {value.body && (
        <p className={`mb-4 text-base ${isDark ? 'text-white/80' : 'text-ink-2'}`}>{value.body}</p>
      )}
      {value.ctaLabel && value.ctaLink && (
        <Link
          to={value.ctaLink}
          className={`inline-block font-medium px-6 py-2.5 rounded-full transition-colors press ${
            isDark ? 'bg-paper text-ink hover:bg-paper-2' : 'bg-ink text-white hover:bg-ink-2'
          }`}
        >
          {value.ctaLabel}
        </Link>
      )}
    </Reveal>
  )
}

function BlogVideoEmbedBlock({ value }: { value: any }) {
  const url = value.url ?? ''
  let embedUrl = ''

  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)
  if (ytMatch) embedUrl = `https://www.youtube-nocookie.com/embed/${ytMatch[1]}`

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/)
  if (vimeoMatch) embedUrl = `https://player.vimeo.com/video/${vimeoMatch[1]}`

  if (!embedUrl) return null

  return (
    <figure className="my-8">
      <div className="aspect-video rounded-lg overflow-hidden bg-ink">
        <iframe
          src={embedUrl}
          title={value.caption || 'Video'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
          className="w-full h-full"
        />
      </div>
      {value.caption && (
        <figcaption className="text-[13px] text-ink-3 mt-2">{value.caption}</figcaption>
      )}
    </figure>
  )
}

// ── Portable Text components config ──────────────────────────────────────

const ptComponents = {
  block: {
    h2: ({ children, value }: any) => {
      const text = blockText(value)
      return (
        <h2
          id={slugify(text)}
          className="text-ink text-2xl md:text-[1.75rem] xl:text-[2rem] leading-[1.15] mt-10 md:mt-12 xl:mt-14 mb-4 scroll-mt-24"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          <Reveal variant="up" as="span" className="block">
            <span className="block w-8 h-0.5 bg-coral mb-3" aria-hidden="true" />
            {children}
          </Reveal>
        </h2>
      )
    },
    h3: ({ children, value }: any) => {
      const text = blockText(value)
      return (
        <h3
          id={slugify(text)}
          className="text-ink text-xl md:text-[1.375rem] xl:text-2xl leading-[1.2] mt-8 mb-3 scroll-mt-24"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          {children}
        </h3>
      )
    },
    h4: ({ children }: any) => (
      <h4
        className="text-ink text-[1.0625rem] md:text-lg leading-[1.3] mt-6 mb-2"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
      >
        {children}
      </h4>
    ),
    normal: ({ children }: any) => (
      <p
        className="text-ink-2 text-[1.0625rem] md:text-lg xl:text-[1.1875rem] leading-[1.7] mb-4"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
      >
        {children}
      </p>
    ),
    blockquote: ({ children }: any) => (
      <blockquote
        className="my-6 pl-5 border-l-2 border-coral italic text-ink-2 text-[1.0625rem] md:text-lg leading-[1.7]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {children}
      </blockquote>
    ),
  },
  list: {
    bullet: ({ children }: any) => (
      <ul
        className="list-disc pl-6 mb-4 space-y-1.5 text-ink-2 text-[1.0625rem] md:text-lg xl:text-[1.1875rem] leading-[1.7]"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
      >
        {children}
      </ul>
    ),
    number: ({ children }: any) => (
      <ol
        className="list-decimal pl-6 mb-4 space-y-1.5 text-ink-2 text-[1.0625rem] md:text-lg xl:text-[1.1875rem] leading-[1.7]"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
      >
        {children}
      </ol>
    ),
  },
  listItem: {
    bullet: ({ children }: any) => <li className="leading-[1.7]">{children}</li>,
    number: ({ children }: any) => <li className="leading-[1.7]">{children}</li>,
  },
  marks: {
    strong: ({ children }: any) => <strong className="font-semibold text-ink">{children}</strong>,
    em: ({ children }: any) => <em>{children}</em>,
    underline: ({ children }: any) => <span className="underline">{children}</span>,
    strikethrough: ({ children }: any) => <s>{children}</s>,
    code: ({ children }: any) => (
      <code className="bg-paper-2 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
    ),
    link: ({ children, value }: any) => (
      <a
        href={value.href}
        target={value.openInNewTab ? '_blank' : undefined}
        rel={value.openInNewTab ? 'noopener noreferrer' : undefined}
        className="text-coral underline decoration-1 underline-offset-2 hover:text-coral-2 transition-colors"
      >
        {children}
      </a>
    ),
    internalLink: ({ children, value }: any) => {
      const ref = value.reference
      if (!ref) return <>{children}</>
      const href = ref._type === 'blogPost' ? `/notebook/${ref.slug?.current ?? ''}` : `/pages/${ref.slug?.current ?? ''}`
      return (
        <Link to={href} className="text-coral underline decoration-1 underline-offset-2 hover:text-coral-2 transition-colors">
          {children}
        </Link>
      )
    },
  },
  types: {
    blogImage:        BlogImageBlock,
    blogPullQuote:    BlogPullQuoteBlock,
    blogProductEmbed: BlogProductEmbedBlock,
    blogCta:          BlogCtaBlock,
    blogVideoEmbed:   BlogVideoEmbedBlock,
  },
}

// FAQ wash renderers (art direction §4): the FAQ H2 becomes the panel's
// kicker (keeping its anchor id for the TOC), questions render at H3 scale
// with hairline dividers, everything stays open on the page and crawlable.
const faqComponents = {
  ...ptComponents,
  block: {
    ...ptComponents.block,
    h2: ({ value }: any) => {
      const text = blockText(value)
      return (
        <h2 id={slugify(text)} className="kicker scroll-mt-24 mb-2">
          {text}
        </h2>
      )
    },
    h3: ({ children, value }: any) => {
      const text = blockText(value)
      return (
        <h3
          id={slugify(text)}
          className="text-ink text-lg md:text-xl leading-[1.2] pt-5 mt-5 border-t border-line first-of-type:border-t-0 first-of-type:mt-0 mb-2 scroll-mt-24"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          {children}
        </h3>
      )
    },
  },
}

const FAQ_HEADING = /^(frequently asked questions|common questions)/i

// ── Main component ───────────────────────────────────────────────────────

export function BlogBody({
  body,
  productMap = {},
}: {
  body: unknown[]
  productMap?: Record<string, Product>
}) {
  // Split the body at the FAQ heading so the mandatory FAQ section renders
  // inside its wash panel. Posts without one render exactly as before.
  const blocks = body as any[]
  const faqStart = blocks.findIndex(
    (b) => b?._type === 'block' && b.style === 'h2' && FAQ_HEADING.test(blockText(b)),
  )
  let faqEnd = -1
  if (faqStart >= 0) {
    // The FAQ panel runs until the next H2 (or the end of the post).
    const after = blocks
      .slice(faqStart + 1)
      .findIndex((b) => b?._type === 'block' && b.style === 'h2')
    faqEnd = after === -1 ? blocks.length : faqStart + 1 + after
  }

  const main = faqStart >= 0 ? blocks.slice(0, faqStart) : blocks
  const faq = faqStart >= 0 ? blocks.slice(faqStart, faqEnd) : []
  const tail = faqStart >= 0 ? blocks.slice(faqEnd) : []

  return (
    <ProductMapContext.Provider value={productMap}>
      <div className="blog-body max-w-none">
        <div className="notebook-dropcap">
          <PortableText value={main as any} components={ptComponents} />
          {/* clearfix for floated images + margin pull quotes */}
          <div className="clear-both" />
        </div>

        {faq.length > 0 && (
          <Reveal variant="fade" as="section" className="my-8 bg-paper-2 rounded-lg p-6 md:p-8">
            <PortableText value={faq as any} components={faqComponents} />
          </Reveal>
        )}

        {tail.length > 0 && (
          <div>
            <PortableText value={tail as any} components={ptComponents} />
            <div className="clear-both" />
          </div>
        )}
      </div>
    </ProductMapContext.Provider>
  )
}
