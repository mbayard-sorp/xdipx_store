import type { MetaFunction } from 'react-router'
import { useState } from 'react'
import { FAQStructuredData } from '~/components/seo/FAQStructuredData'

export const meta: MetaFunction = () => [
  { title: 'FAQ — xdipx' },
  { name: 'description', content: 'Questions about shipping, billing, returns, and xdipx. We answer everything.' },
  { tagName: 'link', rel: 'canonical', href: 'https://xdipx.com/faq' },
]

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
  }
}

const FAQ_SECTIONS = [
  {
    heading: 'Shipping & Packaging',
    items: [
      {
        q: 'Will anyone know what\'s inside?',
        a: 'Absolutely not. Every xdipx order ships in a plain, unmarked box or poly mailer. No logos, no hints, nothing. The return address will say "XD Inc." — boring on purpose.',
      },
      {
        q: 'How fast does it ship?',
        a: 'Most orders ship within 1–2 business days. Standard delivery is 3–7 business days depending on your location.',
      },
    ],
  },
  {
    heading: 'Billing',
    items: [
      {
        q: 'What will appear on my credit card statement?',
        a: 'A discreet descriptor — not xdipx. We\'ll confirm exactly what it shows in your order confirmation email.',
      },
    ],
  },
  {
    heading: 'Returns',
    items: [
      {
        q: 'What\'s your return policy?',
        a: 'Unopened items in original packaging within 14 days. Hygiene restrictions apply to used products. Something wrong? Email us at hello@xdipx.com — we\'ll make it right.',
      },
    ],
  },
  {
    heading: 'About xdipx',
    items: [
      {
        q: 'What does xdipx mean?',
        a: 'It\'s a palindrome. Reads the same forwards and backwards. Just like our products: built for everyone, from every angle. ♥',
      },
      {
        q: 'How does the daily deal work?',
        a: 'We run exactly one featured deal per day. It goes live at midnight and disappears 24 hours later. Same deal, all day. No code needed — the price is already the deal.',
      },
      {
        q: 'Do you share my information?',
        a: 'Never. Your privacy is paramount. We use your email only to send deal notifications if you opt in. Full details in our Privacy Policy.',
      },
    ],
  },
]

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
