import type { MetaFunction } from 'react-router'

export const meta: MetaFunction = () => [
  { title: 'About xdipx' },
  { name: 'description', content: 'xdipx — one deal every day for intimate wellness. Playful, discreet, for everyone.' },
  { tagName: 'link', rel: 'canonical', href: 'https://xdipx.com/about' },
]

export default function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <h1
        className="text-4xl font-black text-brand-gradient mb-6"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        xdipx
      </h1>

      <div className="prose prose-sm max-w-none text-brand-charcoal/80 space-y-5">
        <p className="text-lg text-brand-charcoal font-medium leading-relaxed">
          Look, we all have a drawer. Let's make it a great one.
        </p>

        <p>
          xdipx is a daily deal site for sexual wellness products. One featured deal every day.
          Launched at midnight. Gone in 24 hours. No catches, no codes — the price is the deal.
        </p>

        <p>
          The name is a palindrome. Reads the same forwards and backwards — just like our ethos.
          xdipx is built for everyone, from every angle. ♥
        </p>

        <p>
          We source from established brands through licensed distributors. Everything ships in
          plain, unmarked packaging. Billing appears as "XD Inc." Your business is your business.
        </p>

        <p>
          We believe the conversation around pleasure and wellness has been way too awkward for
          way too long. We're fixing that — one playful deal at a time.
        </p>
      </div>

      <div className="mt-10 flex flex-col sm:flex-row gap-4">
        <a
          href="/"
          className="bg-brand-gradient text-white font-bold px-6 py-3 rounded-full text-center hover:opacity-90 transition-opacity"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          See today's deal ♥
        </a>
        <a
          href="mailto:hello@xdipx.com"
          className="border border-brand-mist text-brand-charcoal/70 font-medium px-6 py-3 rounded-full text-center hover:bg-brand-mist transition-colors"
        >
          Say hi
        </a>
      </div>
    </div>
  )
}
