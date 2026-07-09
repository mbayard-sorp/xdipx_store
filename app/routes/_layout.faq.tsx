import type { MetaFunction } from 'react-router'
import { useState } from 'react'
import { FAQStructuredData } from '~/components/seo/FAQStructuredData'
import { FAQ_SECTIONS } from '~/lib/faq-content'

export const meta: MetaFunction = () => [
  { title: 'FAQ — xdipx' },
  { name: 'description', content: 'Questions about shipping, billing, returns, and xdipx. We answer everything.' },
  { tagName: 'link', rel: 'canonical', href: 'https://xdipx.com/faq' },
  { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: 'https://xdipx.com/faq.md' },
]

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
  }
}

const ALL_FAQS = FAQ_SECTIONS.flatMap(s => s.items)

export default function FAQPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1
        className="text-3xl font-bold text-ink mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Questions ♥
      </h1>
      <p className="text-ink/60 mb-10">
        We're an open book. Here's everything you might want to know.
      </p>

      {FAQ_SECTIONS.map(section => (
        <div key={section.heading} className="mb-8">
          <h2
            className="text-sm uppercase tracking-widest font-semibold text-sage mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {section.heading}
          </h2>
          <div className="space-y-2">
            {section.items.map(item => (
              <FAQItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      ))}

      <div className="mt-10 bg-cream-2 rounded-2xl p-6 text-center">
        <p className="text-ink/70">
          Still have a question?{' '}
          <a href="mailto:hello@xdipx.com" className="text-sage font-semibold hover:underline">
            Email us
          </a>
          . We respond fast. ♥
        </p>
      </div>

      <FAQStructuredData faqs={ALL_FAQS.map(f => ({ question: f.q, answer: f.a }))} />
    </div>
  )
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white rounded-xl overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        aria-expanded={open}
      >
        <span
          className="font-semibold text-ink text-sm"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {q}
        </span>
        <span
          className={`text-sage text-lg transition-transform ${open ? 'rotate-45' : ''}`}
          aria-hidden="true"
        >
          +
        </span>
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-ink/70 leading-relaxed border-t border-cream-2 pt-3">
          {a}
        </div>
      )}
    </div>
  )
}
