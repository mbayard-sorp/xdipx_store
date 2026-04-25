import type { ProductFaq } from '~/types/cms'

interface ProductFaqListProps {
  faqs: ProductFaq[]
}

/**
 * Visible FAQ accordion shown inside the ProductSummaryGrid "FAQs / Q&A"
 * card. Uses native <details>/<summary> for accessibility and zero JS.
 *
 * The visible answer text MUST stay 1:1 with the FAQPage JSON-LD payload —
 * Google flags hidden-content schema. Truncation/clamping happens via CSS
 * inside <summary> only; the <p> answer is full-text and crawlable.
 */
export function ProductFaqList({ faqs }: ProductFaqListProps) {
  if (faqs.length === 0) {
    return (
      <p className="text-sm text-ink/60 italic">
        Quick answers to common questions are coming soon.
      </p>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-line">
      {faqs.map((faq, i) => (
        <li key={i} className="py-2 first:pt-0 last:pb-0">
          <details className="group">
            <summary className="flex items-start gap-2 cursor-pointer list-none text-sm font-medium text-ink leading-snug">
              <span
                aria-hidden="true"
                className="shrink-0 text-coral text-xs mt-0.5 group-open:rotate-90 transition-transform"
              >
                ▶
              </span>
              <span className="flex-1">{faq.question}</span>
            </summary>
            <p className="mt-1.5 ml-5 text-sm text-ink/75 leading-relaxed whitespace-pre-line">
              {faq.answer}
            </p>
          </details>
        </li>
      ))}
    </ul>
  )
}
