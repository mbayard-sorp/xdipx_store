import { ExpandableHtml } from '~/components/store/ExpandableHtml'
import { ProductFaqList } from '~/components/store/ProductFaqList'
import type { ProductFaq } from '~/types/cms'

interface ProductSummaryGridProps {
  productTitle:       string
  productType?:       string
  brand?:             string
  descriptionHtml:    string
  boxContents:        string[]
  /** Free-text care steps from the xdipx.care_instructions metafield.
   *  Rendered as a bullet list in the Care card. Takes priority over
   *  careFaqs when both are configured — editors treat this field as the
   *  canonical care-instructions source. */
  careInstructions?:  string[]
  /** Care-categorized FAQs (Sanity productFaq with category="care"). Used
   *  as a fallback accordion in the Care card when no careInstructions
   *  bullets exist. The route already excludes these from the main FAQ
   *  card whenever this fallback path is active to avoid duplicate
   *  visible content. */
  careFaqs?:          ProductFaq[]
  /** Phase 2 — string[] of "Label: Value" bullets. Mirrors the care/box
   *  bullet shape; renders as a `<ul>` in the Specs grid card. */
  specifications?:    string[] | undefined
  faqCount?:          number
  faqSlot?:           React.ReactNode
  emmaSlot?:          React.ReactNode
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

interface CardProps {
  href?:      string
  eyebrow:    string
  body?:      string
  bodyHtml?:  string
  bodySlot?:  React.ReactNode
  className?: string
  /** Max line count before the body clamps and "more" appears. Default 12.
   *  Used for paragraph copy (e.g. "What it does"). */
  clampLines?: number
  /** Item-aware clamp for `<li>` bullet content. When set, takes precedence
   *  over `clampLines`. Use this for the bullet cards so wrapping items
   *  don't trip the toggle prematurely. */
  clampItems?: number
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

function SummaryCard({ href, eyebrow, body, bodyHtml, bodySlot, className = '', clampLines = 12, clampItems }: CardProps) {
  const baseClass =
    'flex flex-col h-full p-5 bg-paper rounded-[var(--radius-lg)] border border-line transition-all'
  const interactiveClass = href ? 'hover:border-coral hover:shadow-md' : ''

  const inner = (
    <>
      {/* H2 sits under the PDP H1 (product title). Each summary card is a
          peer-level topic ("Care Instructions", "FAQs / Q&A", "Emma's take",
          etc.) — the H2 hierarchy gives Google explicit topic clusters
          instead of inferring structure from styled divs. */}
      <h2
        className="text-[11px] uppercase tracking-[0.18em] text-ink-3 mb-2 font-medium"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {eyebrow}
      </h2>
      {bodySlot
        ? <div className="flex-1 min-h-0">{bodySlot}</div>
        : bodyHtml
          ? (
            <div className="flex-1 min-h-0">
              <ExpandableHtml
                html={bodyHtml}
                clampLines={clampLines}
                {...(clampItems ? { clampItems } : {})}
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
  careInstructions,
  careFaqs,
  specifications,
  faqCount = 0,
  faqSlot,
  emmaSlot,
}: ProductSummaryGridProps) {
  const descBodyHtml = descriptionHtml
    ? firstParagraphHtml(descriptionHtml)
    : ''
  const descFallback = `Get the full story on the ${productTitle}${brand ? ` from ${brand}` : ''}.`

  // Box / Care-bullets / Specs all render the FULL list and rely on the
  // shared ExpandableHtml clamp + more/close affordance (mirrors the "What
  // it does" card). No upstream slicing — overflow detection picks the
  // expander up automatically when the rendered list exceeds clampLines.
  const boxBodyHtml = boxContents.length > 0
    ? `<ul>${boxContents.map(i => `<li>${i}</li>`).join('')}</ul>`
    : ''
  const boxFallback = 'See exactly what arrives in your discreet package.'

  // Care card priority: legacy careInstructions bullets first (canonical
  // editorial source), care-tagged productFaqs second (richer Q&A
  // accordion). When the bullets exist, the route also folds care FAQs
  // back into the main FAQ card so the full set stays visible.
  const careLegacyItems = careInstructions ?? []
  const hasCareLegacy   = careLegacyItems.length > 0
  const hasCareFaqs     = !hasCareLegacy && (careFaqs ?? []).length > 0
  const careBodyHtml = hasCareLegacy
    ? `<ul>${careLegacyItems.map(i => `<li>${i}</li>`).join('')}</ul>`
    : ''
  const careFallback = 'Quick care + storage notes so it stays good for the long haul.'

  const specItems = specifications ?? []
  const specBodyHtml = specItems.length > 0
    ? `<ul>${specItems.map(i => `<li>${i}</li>`).join('')}</ul>`
    : ''
  const specFallback = `Materials, dimensions, charging, waterproof rating${productType ? ` for the ${productType}` : ''}.`

  const faqSummary = faqCount > 0
    ? `${faqCount} answers to the questions buyers actually ask${productType ? ` about ${productType}s` : ''}.`
    : `Quick answers to the most common questions${productType ? ` about ${productType}s` : ''} — coming soon.`

  return (
    <section
      aria-label="Product details overview"
      className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3"
    >
      {/* Row 1 — What it does (2/6) + FAQs (4/6) */}
      <SummaryCard
        eyebrow="What it does"
        className="lg:col-span-2"
        {...(descBodyHtml ? { bodyHtml: descBodyHtml } : { body: descFallback })}
      />
      <SummaryCard
        eyebrow="FAQs / Q&A"
        className="lg:col-span-4"
        {...(faqSlot ? { bodySlot: faqSlot } : { body: faqSummary })}
      />

      {/* Row 2 — Care Instructions + In the box + Specs (three equal cards).
          Bullet cards use the same ExpandableHtml clamp + more/close
          affordance as "What it does", but clamp by ITEM count (clampItems)
          rather than lines so wrapping bullets don't surface the toggle
          prematurely. Editorial bullet budgets: Care 5, Box 10, Specs 10. */}
      <SummaryCard
        eyebrow="Care Instructions"
        className="lg:col-span-2"
        clampItems={5}
        {...(hasCareFaqs
          ? { bodySlot: <ProductFaqList faqs={careFaqs!} /> }
          : careBodyHtml
            ? { bodyHtml: careBodyHtml }
            : { body: careFallback })}
      />
      <SummaryCard
        eyebrow="In the box"
        className="lg:col-span-2"
        clampItems={10}
        {...(boxBodyHtml ? { bodyHtml: boxBodyHtml } : { body: boxFallback })}
      />
      <SummaryCard
        eyebrow="Specs"
        className="lg:col-span-2"
        clampItems={10}
        {...(specBodyHtml ? { bodyHtml: specBodyHtml } : { body: specFallback })}
      />

      {/* Row 3 — Emma's take, full grid width */}
      <SummaryCard
        eyebrow="Emma's take"
        className="lg:col-span-6"
        bodySlot={emmaSlot ?? <p className="text-sm text-ink/60 italic">Emma's note loads in a moment…</p>}
      />
    </section>
  )
}
