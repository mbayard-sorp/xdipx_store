import type { MetaFunction } from 'react-router'
import { Link } from 'react-router'

const CANONICAL = 'https://xdipx.com/contributors/emma'

export const meta: MetaFunction = () => [
  { title: 'Emma, xdipx’s AI guide, contributor profile | xdipx' },
  {
    name: 'description',
    content:
      'Emma is xdipx’s AI guide, writing product picks and Notebook guides from catalog knowledge and specs, with human editorial oversight. No lived experience claimed.',
  },
  { tagName: 'link', rel: 'canonical', href: CANONICAL },
  { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: `${CANONICAL}.md` },
]

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
  }
}

const PROFILE_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'ProfilePage',
  '@id': `${CANONICAL}#profile`,
  url: CANONICAL,
  name: 'Emma, xdipx contributor profile',
  description:
    'Emma is an AI-generated editorial persona built by the xdipx team. She has no lived experience and writes from catalog knowledge, product specs, and review patterns, with every piece reviewed by a human editor before it publishes.',
  mainEntity: {
    '@type': 'Person',
    name: 'Emma',
    jobTitle: 'AI Guide, xdipx',
    description:
      'Emma is an AI-generated editorial persona, not a real person. She has never used, tried, tested, owned, or held any product. Her guidance is drawn from catalog data, manufacturer specs, and aggregated review patterns, and every piece she writes is checked by a human editor before publishing.',
    url: CANONICAL,
    worksFor: {
      '@type': 'Organization',
      '@id': 'https://xdipx.com/#organization',
      name: 'xdipx',
      url: 'https://xdipx.com',
    },
  },
  publisher: {
    '@type': 'Organization',
    '@id': 'https://xdipx.com/#organization',
    name: 'xdipx',
    url: 'https://xdipx.com',
  },
}

export default function EmmaContributorProfile() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <p
        className="text-xs font-mono uppercase tracking-widest text-coral mb-3"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        Contributor
      </p>
      <h1
        className="text-3xl font-bold text-ink mb-4"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Emma
      </h1>
      <p className="text-ink/70 leading-relaxed mb-6">
        Emma is xdipx&rsquo;s AI guide, built by the xdipx team to help people shop with less
        guesswork. She&rsquo;s not a real person and has no lived experience, so she never says
        she&rsquo;s tried, tested, or owned anything. What she does have is catalog knowledge:
        product specs, materials, and the patterns that show up across real customer reviews.
        Every piece she writes gets a human editorial check before it goes live.
      </p>

      <h2
        className="text-lg font-bold text-ink mt-8 mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        What Emma covers
      </h2>
      <ul className="text-ink/70 leading-relaxed list-disc list-inside space-y-1 mb-6">
        <li>Product guidance on picks and pairings, drawn from specs and review data</li>
        <li>
          Guides and explainers on{' '}
          <Link to="/notebook" className="text-coral hover:underline">
            the Notebook
          </Link>
        </li>
        <li>
          Finding a starting point through{' '}
          <Link to="/discover" className="text-coral hover:underline">
            the Compass
          </Link>
          , our discovery finder
        </li>
      </ul>

      <h2
        className="text-lg font-bold text-ink mt-8 mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        How Emma writes
      </h2>
      <p className="text-ink/70 leading-relaxed mb-6">
        No wrong answers, no assumptions about experience level. She speaks plainly about what a
        product does and how it works, without embarrassment and without hype. If she recommends
        something, it&rsquo;s because the spec or the review pattern actually supports it.
      </p>

      <div className="mt-10 bg-cream-2 rounded-2xl p-6">
        <p className="text-ink/70">
          Curious who&rsquo;s behind xdipx end to end?{' '}
          <Link to="/about" className="text-coral font-semibold hover:underline">
            Read our about page
          </Link>
          .
        </p>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(PROFILE_SCHEMA) }}
      />
    </div>
  )
}
