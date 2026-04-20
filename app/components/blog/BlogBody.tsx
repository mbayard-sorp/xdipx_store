import { PortableText } from '@portabletext/react'
import { Link } from 'react-router'
import { createContext, useContext } from 'react'
import type { Product } from '~/types'

// ── Product context for blogProductEmbed blocks ──────────────────────────

const ProductMapContext = createContext<Record<string, Product>>({})

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// ── Custom block components ──────────────────────────────────────────────

function BlogImageBlock({ value }: { value: any }) {
  const layout = value.layout ?? 'full-width'
  const imageUrl = value.image?.url
  if (!imageUrl) return null

  if (layout === 'side-by-side') {
    return (
      <figure className="my-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <img src={imageUrl} alt={value.alt ?? ''} loading="lazy" className="rounded-xl w-full" />
          {value.caption && <figcaption className="text-sm text-ink/50 mt-2">{value.caption}</figcaption>}
        </div>
        {value.secondImage?.url && (
          <div>
            <img src={value.secondImage.url} alt={value.secondAlt ?? ''} loading="lazy" className="rounded-xl w-full" />
            {value.secondCaption && <figcaption className="text-sm text-ink/50 mt-2">{value.secondCaption}</figcaption>}
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
      <img src={imageUrl} alt={value.alt ?? ''} loading="lazy" className="rounded-xl w-full" />
      {value.caption && (
        <figcaption className="text-sm text-ink/50 mt-2 px-4 sm:px-0">{value.caption}</figcaption>
      )}
    </figure>
  )
}

function BlogPullQuoteBlock({ value }: { value: any }) {
  const style = value.style ?? 'default'
  const sizeClass = style === 'large' ? 'text-2xl sm:text-3xl' : 'text-xl'
  const borderClass = style === 'accent' ? 'border-coral' : 'border-sage'

  return (
    <blockquote className={`my-8 pl-6 border-l-4 ${borderClass}`}>
      <p className={`${sizeClass} font-display font-medium text-ink italic leading-relaxed`}>
        "{value.quote}"
      </p>
      {value.attribution && (
        <cite className="block mt-2 text-sm text-ink/60 not-italic">
          — {value.attribution}
        </cite>
      )}
    </blockquote>
  )
}

function BlogProductEmbedBlock({ value }: { value: any }) {
  const productMap = useContext(ProductMapContext)
  const product = productMap[value.productHandle]
  const layout = value.layout ?? 'card'
  const ctaLabel = value.ctaLabel ?? 'Shop Now ♥'
  const href = `/products/${value.productHandle}`

  if (!product) {
    return (
      <div className="my-8 p-4 bg-cream-2 rounded-xl text-center text-sm text-ink/60">
        <Link to={href} className="text-sage hover:underline">{ctaLabel}</Link>
      </div>
    )
  }

  if (layout === 'inline') {
    return (
      <div className="my-4 inline-flex items-center gap-3 bg-cream-2 rounded-full px-4 py-2">
        {product.images[0] && (
          <img src={product.images[0].url} alt={product.title} className="w-8 h-8 rounded-full object-cover" />
        )}
        <Link to={href} className="text-sm font-medium text-sage hover:underline">
          {product.title} — {ctaLabel}
        </Link>
      </div>
    )
  }

  if (layout === 'banner') {
    return (
      <div className="my-8 bg-coral rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6 text-white">
        {product.images[0] && (
          <img src={product.images[0].url} alt={product.title} className="w-24 h-24 rounded-xl object-cover shrink-0" />
        )}
        <div className="flex-1 text-center sm:text-left">
          <p className="font-display font-bold text-lg">{product.title}</p>
          <p className="text-white/80 text-sm">{product.brand}</p>
        </div>
        <Link
          to={href}
          className="shrink-0 bg-white text-coral font-semibold px-6 py-2.5 rounded-full hover:bg-cream transition-colors"
        >
          {ctaLabel}
        </Link>
      </div>
    )
  }

  // card (default)
  return (
    <div className="my-8 bg-white border border-cream-2 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center gap-4 shadow-sm">
      {product.images[0] && (
        <img src={product.images[0].url} alt={product.title} loading="lazy" className="w-20 h-20 rounded-xl object-cover shrink-0" />
      )}
      <div className="flex-1 text-center sm:text-left">
        <p className="font-display font-semibold text-ink">{product.title}</p>
        {product.brand && <p className="text-sm text-ink/50">{product.brand}</p>}
      </div>
      <Link
        to={href}
        className="shrink-0 bg-coral text-white font-semibold px-5 py-2.5 rounded-full hover:opacity-90 transition-opacity"
      >
        {ctaLabel}
      </Link>
    </div>
  )
}

function BlogCtaBlock({ value }: { value: any }) {
  const bgStyle = value.bgStyle ?? 'gradient'
  const bgClass =
    bgStyle === 'gradient'  ? 'bg-coral text-white' :
    bgStyle === 'purple'    ? 'bg-sage text-white' :
    bgStyle === 'mist'      ? 'bg-cream-2 text-ink' :
    bgStyle === 'cream'     ? 'bg-cream text-ink' :
    'bg-ink text-white'

  const isLight = bgStyle === 'mist' || bgStyle === 'cream'

  return (
    <div className={`my-8 rounded-2xl p-6 sm:p-8 text-center ${bgClass}`}>
      {value.heading && (
        <p className="font-display font-bold text-xl sm:text-2xl mb-2">{value.heading}</p>
      )}
      {value.body && (
        <p className={`mb-4 ${isLight ? 'text-ink/70' : 'text-white/80'}`}>{value.body}</p>
      )}
      {value.ctaLabel && value.ctaLink && (
        <Link
          to={value.ctaLink}
          className={`inline-block font-semibold px-6 py-2.5 rounded-full transition-colors ${
            isLight
              ? 'bg-sage text-white hover:bg-sun'
              : 'bg-white text-ink hover:bg-cream'
          }`}
        >
          {value.ctaLabel}
        </Link>
      )}
    </div>
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
      <div className="aspect-video rounded-xl overflow-hidden bg-ink">
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
        <figcaption className="text-sm text-ink/50 mt-2">{value.caption}</figcaption>
      )}
    </figure>
  )
}

// ── Portable Text components config ──────────────────────────────────────

const ptComponents = {
  block: {
    h2: ({ children, value }: any) => {
      const text = value.children?.map((c: any) => c.text ?? '').join('') ?? ''
      return <h2 id={slugify(text)} className="font-display font-bold text-2xl sm:text-3xl text-ink mt-10 mb-4 scroll-mt-24">{children}</h2>
    },
    h3: ({ children, value }: any) => {
      const text = value.children?.map((c: any) => c.text ?? '').join('') ?? ''
      return <h3 id={slugify(text)} className="font-display font-semibold text-xl sm:text-2xl text-ink mt-8 mb-3 scroll-mt-24">{children}</h3>
    },
    h4: ({ children }: any) => (
      <h4 className="font-display font-semibold text-lg text-ink mt-6 mb-2">{children}</h4>
    ),
    normal: ({ children }: any) => (
      <p className="text-ink/90 leading-relaxed mb-4">{children}</p>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="my-6 pl-5 border-l-3 border-sage italic text-ink/80">
        {children}
      </blockquote>
    ),
  },
  list: {
    bullet: ({ children }: any) => <ul className="list-disc pl-6 mb-4 space-y-1.5 text-ink/90">{children}</ul>,
    number: ({ children }: any) => <ol className="list-decimal pl-6 mb-4 space-y-1.5 text-ink/90">{children}</ol>,
  },
  listItem: {
    bullet: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
    number: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
  },
  marks: {
    strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }: any) => <em>{children}</em>,
    underline: ({ children }: any) => <span className="underline">{children}</span>,
    strikethrough: ({ children }: any) => <s>{children}</s>,
    code: ({ children }: any) => (
      <code className="bg-cream-2 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
    ),
    link: ({ children, value }: any) => (
      <a
        href={value.href}
        target={value.openInNewTab ? '_blank' : undefined}
        rel={value.openInNewTab ? 'noopener noreferrer' : undefined}
        className="text-sage underline hover:text-sun transition-colors"
      >
        {children}
      </a>
    ),
    internalLink: ({ children, value }: any) => {
      const ref = value.reference
      if (!ref) return <>{children}</>
      const href = ref._type === 'blogPost' ? `/notebook/${ref.slug?.current ?? ''}` : `/pages/${ref.slug?.current ?? ''}`
      return (
        <Link to={href} className="text-sage underline hover:text-sun transition-colors">
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

// ── Main component ───────────────────────────────────────────────────────

export function BlogBody({
  body,
  productMap = {},
}: {
  body: unknown[]
  productMap?: Record<string, Product>
}) {
  return (
    <ProductMapContext.Provider value={productMap}>
      <div className="blog-body max-w-none">
        <PortableText value={body as any} components={ptComponents} />
        {/* clearfix for floated images */}
        <div className="clear-both" />
      </div>
    </ProductMapContext.Provider>
  )
}
