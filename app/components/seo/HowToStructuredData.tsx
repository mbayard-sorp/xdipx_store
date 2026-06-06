interface HowToStep {
  /** Short imperative step title. */
  name: string
  /** Step body text. Must match the visible step content 1:1. */
  text: string
  /** Optional step image URL. */
  image?: string | null
  /** Optional deep-link/anchor to the step on the page. */
  url?: string | null
}

interface HowToStructuredDataProps {
  name:        string
  description: string
  /** Canonical URL of the guide page. */
  url:         string
  steps:       HowToStep[]
  /** ISO-8601 duration, e.g. "PT15M". Omit if unknown. */
  totalTime?:  string | null
  /** Things the reader needs but doesn't consume (e.g. "Warm water"). */
  tools?:      string[]
  /** Consumable supplies (e.g. "Water-based lubricant"). */
  supplies?:   string[]
  /** Lead image for the guide. */
  image?:      string | null
}

/**
 * HowTo JSON-LD for educational / how-to guide pages. Emit only when the page
 * actually renders the same ordered steps in visible content — the step `text`
 * must match what the reader sees, or Google treats it as a structured-data
 * mismatch.
 */
export function HowToStructuredData({
  name, description, url, steps, totalTime, tools, supplies, image,
}: HowToStructuredDataProps) {
  if (!steps.length) return null

  const schema = {
    '@context': 'https://schema.org',
    '@type':    'HowTo',
    name,
    description,
    ...(image ? { image } : {}),
    ...(totalTime ? { totalTime } : {}),
    ...(tools?.length
      ? { tool: tools.map(t => ({ '@type': 'HowToTool', name: t })) }
      : {}),
    ...(supplies?.length
      ? { supply: supplies.map(s => ({ '@type': 'HowToSupply', name: s })) }
      : {}),
    step: steps.map((s, i) => ({
      '@type':   'HowToStep',
      position:  i + 1,
      name:      s.name,
      text:      s.text,
      ...(s.image ? { image: s.image } : {}),
      url:       s.url ?? `${url}#step-${i + 1}`,
    })),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
