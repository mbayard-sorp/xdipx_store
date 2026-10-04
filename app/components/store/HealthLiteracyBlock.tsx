import type { Deal } from '~/types'
import { buildHealthBlockContent, HEALTH_DISCLAIMER } from '~/lib/health-literacy'

interface HealthLiteracyBlockProps {
  deal: Pick<Deal, 'productTypeDial' | 'specifications' | 'audienceTags' | 'careInstructions'>
}

/**
 * Health and body-literacy block (Ad Studio v2 PR-D, ads-policy M1). Rendered
 * to every visitor on PDPs in the Meta lane subset, below the page content and
 * above reviews. It restates what the product already carries (mechanism,
 * materials, audience, care) in plain words at register 3-4. When the product
 * has none of those fields it renders nothing rather than inventing text.
 */
export function HealthLiteracyBlock({ deal }: HealthLiteracyBlockProps) {
  const c = buildHealthBlockContent(deal)
  if (!c) return null

  const rows: Array<{ label: string; body: React.ReactNode }> = []
  if (c.mechanism || c.mechanismSpecs.length > 0) {
    rows.push({
      label: 'What it is',
      body: (
        <>
          {c.mechanism ? <p>{c.mechanism}</p> : null}
          {c.mechanismSpecs.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {c.mechanismSpecs.map(s => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : null}
        </>
      ),
    })
  }
  if (c.materials.length > 0) {
    rows.push({
      label: 'Materials',
      body: (
        <ul className="list-disc pl-5">
          {c.materials.map(s => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      ),
    })
  }
  if (c.audience.length > 0) {
    rows.push({ label: 'Who it is for', body: <p>{c.audience.join(', ')}.</p> })
  }
  if (c.care.length > 0) {
    rows.push({
      label: 'Care',
      body: (
        <ul className="list-disc pl-5">
          {c.care.map(s => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      ),
    })
  }

  return (
    <section
      aria-labelledby="health-literacy-heading"
      data-health-block
      className="mx-auto mt-10 max-w-6xl px-4"
    >
      <div className="rounded-[var(--radius-lg)] border border-line bg-paper-2 p-5 md:p-8">
        <p className="kicker text-ink-3">Good to know</p>
        <h2 id="health-literacy-heading" className="mt-1 font-display text-2xl leading-tight text-ink md:text-3xl">
          What it is, what it is made of
        </h2>
        <dl className="mt-5 grid gap-5 md:grid-cols-2">
          {rows.map(r => (
            <div key={r.label}>
              <dt className="font-body text-sm font-semibold text-ink">{r.label}</dt>
              <dd className="mt-1 font-body text-base leading-relaxed text-ink-2">{r.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 border-t border-line pt-4 font-body text-sm text-ink-3">{HEALTH_DISCLAIMER}</p>
      </div>
    </section>
  )
}
