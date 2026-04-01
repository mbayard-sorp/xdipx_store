interface FAQItem { question: string; answer: string }

export function FAQStructuredData({ faqs }: { faqs: FAQItem[] }) {
  const schema = {
    '@context':  'https://schema.org',
    '@type':     'FAQPage',
    mainEntity:  faqs.map(({ question, answer }) => ({
      '@type':         'Question',
      name:             question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
