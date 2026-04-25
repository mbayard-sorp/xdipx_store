import { ExpandableHtml } from '~/components/store/ExpandableHtml'

interface ProductSummaryGridProps {
  productTitle:    string
  productType?:    string
  brand?:          string
  descriptionHtml: string
  boxContents:     string[]
  specifications?: string | undefined
  faqCount?:       number
  emmaSlot?:       React.ReactNode
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Take the first <p>...</p> from an HTML string. Falls back to the first
 * meaningful chunk if no paragraph tag is present. Preserves inline tags
 * (strong, em, a, br, etc.) so the summary cards can render rich formatting.
 */
function firstParagraphHtml(html: string): string {
  if (!html) return ''
  const match = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  if (match && stripHtml(match[1] ?? '').length > 20) return match[1] ?? ''
  // No paragraph tag — return the html as-is, capped on first sentence boundary
  const text = stripHtml(html)
  const period = text.indexOf('. ')
  if (period > 40 && period < 240) return text.slice(0, period + 1)
  return text.slice(0, 200) + (text.length > 200 ? '…' : '')
}

/**
 * Build a short HTML excerpt of a spec block. Prefers the first table row
 * rendered as `<strong>label</strong> value` pairs, then falls back to the
 * first paragraph or a stripped excerpt.
 */
function specsExcerptHtml(html: string, max = 3): string {
  if (!html) return ''
  const rows = Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))
  if (rows.length > 0) {
    const items = rows.slice(0, max).map(row => {
      const cells = Array.from((row[1] ?? '').matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi))
        .map(c => stripHtml(c[1] ?? ''))
        .filter(Boolean)
      if (cells.length === 0) return ''
      if (cells.length === 1) return `<li>${cells[0]}</li>`
      return `<li><strong>${cells[0]}:</strong> ${cells.slice(1).join(' ')}</li>`
    }).filter(Boolean)
    if (items.length > 0) return `<ul>${items.join('')}</ul>`
  }
  return firstParagraphHtml(html)
}

interface CardProps {
  href?:      string
  eyebrow:    string
  body?:      string
  bodyHtml?:  string
  bodySlot?:  React.ReactNode
  className?: string
  /** Max line count before the body clamps and "more" appears. Default 12. */
  clampLines?: number
}

const cardBodyClass =
  'text-sm text-ink/75 leading-relaxed ' +
  '[&_p]:m-0 [&_p+p]:mt-2 ' +
  '[&_strong]:font-semibold [&_strong]:text-ink ' +
  '[&_em]:italic ' +
  '[&_a]:text-coral [&_a]:underline [&_a]:underline-offset-2 ' +
  '[&_ul]:list-none [&_ul]:m-0 [&_ul]:p-0 [&_ul]:space-y-1 ' +
  '[&_li]:flex [&_li]:gap-1.5 [&_li]:items-start [&_li]:before:content-["♥"] [&_li]:before:text-sage [&_li]:before:text-xs [&_li]:before:mt-0.5 ' +
  '[&_br]:block'

function SummaryCard({ href, eyebrow, body, bodyHtml, bodySlot, className = '', clampLines = 12 }: CardProps) {
  const baseClass =
    'flex flex-col h-full p-5 bg-paper rounded-[var(--radius-lg)] border border-line transition-all'
  const interactiveClass = href ? 'hover:border-coral hover:shadow-md' : ''

  const inner = (
    <>
      <div
        className="text-[11px] uppercase tracking-wider text-coral mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {eyebrow}
      </div>
      {bodySlot
        ? <div className="flex-1 min-h-0">{bodySlot}</div>
        : bodyHtml
          ? (
            <div className="flex-1 min-h-0">
              <ExpandableHtml
                html={bodyHtml}
                clampLines={clampLines}
                bodyClass={cardBodyClass}
              />
            </div>
          )
          : <p className={`${cardBodyClass} flex-1`}>{body}</p>}
    </>
  )
  if (!href) {
    return <div className={`${baseClass} ${interactiveClass} ${className}`}>{inner}</div>
  }
  return (
    <a href={href} className={`${baseClass} ${interactiveClass} ${className}`}>
      {inner}
    </a>
  )
}

export function ProductSummaryGrid({
  productTitle,
  productType,
  brand,
  descriptionHtml,
  boxContents,
  specifications,
  faqCount = 0,
  emmaSlot,
}: ProductSummaryGridProps) {
  const descBodyHtml = descriptionHtml
    ? firstParagraphHtml(descriptionHtml)
    : ''
  const descFallback = `Get the full story on the ${productTitle}${brand ? ` from ${brand}` : ''}.`

  const boxBodyHtml = boxContents.length > 0
    ? `<ul>${boxContents.slice(0, 4).map(i => `<li>${i}</li>`).join('')}${boxContents.length > 4 ? `<li>…and ${boxContents.length - 4} more</li>` : ''}</ul>`
    : ''
  const boxFallback = 'See exactly what arrives in your discreet package.'

  const specBodyHtml = specifications ? specsExcerptHtml(specifications) : ''
  const specFallback = `Materials, dimensions, charging, waterproof rating${productType ? ` for the ${productType}` : ''}.`

  const faqSummary = faqCount > 0
    ? `${faqCount} answers to the questions buyers actually ask${productType ? ` about ${productType}s` : ''}.`
    : `Quick answers to the most common questions${productType ? ` about ${productType}s` : ''} — coming soon.`

  return (
    <section
      aria-label="Product details overview"
      className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3"
    >
      {/* Row 1 — What it does (1/3) + FAQs (2/3) */}
      <SummaryCard
        eyebrow="What it does"
        className="lg:col-span-2"
        {...(descBodyHtml ? { bodyHtml: descBodyHtml } : { body: descFallback })}
      />
      <SummaryCard
        eyebrow="FAQs / Q&A"
        className="lg:col-span-4"
        body={faqSummary}
      />

      {/* Row 2 — three equal-width cards */}
      <SummaryCard
        eyebrow="In the box"
        className="lg:col-span-2"
        {...(boxBodyHtml ? { bodyHtml: boxBodyHtml } : { body: boxFallback })}
      />
      <SummaryCard
        eyebrow="Specs"
        className="lg:col-span-2"
        {...(specBodyHtml ? { bodyHtml: specBodyHtml } : { body: specFallback })}
      />
      <SummaryCard
        eyebrow="Emma's take"
        className="lg:col-span-2"
        bodySlot={emmaSlot ?? <p className="text-sm text-ink/60 italic">Emma's note loads in a moment…</p>}
      />
    </section>
  )
}
