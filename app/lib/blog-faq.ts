// Extracts FAQ question/answer pairs from a Notebook post's portable-text body
// so the post route can emit FAQPage JSON-LD that stays 1:1 with the visible
// FAQ section (same principle as the guide ItemList built from blogProductEmbed).

export interface FaqItem {
  question: string
  answer: string
}

const FAQ_HEADING = /^(faq|faqs|frequently asked questions)\b/i

function blockText(block: any): string {
  return (block?.children ?? []).map((c: any) => c.text ?? '').join('')
}

export function extractFaqItems(body: any[]): FaqItem[] {
  const items: FaqItem[] = []
  let inFaq = false
  let question: string | null = null
  let answerParts: string[] = []

  const flush = () => {
    if (question) {
      const answer = answerParts.join(' ').trim()
      if (answer) items.push({ question, answer })
    }
    question = null
    answerParts = []
  }

  for (const block of body ?? []) {
    if (block?._type !== 'block') continue

    if (block.style === 'h2') {
      if (inFaq) {
        flush()
        break
      }
      if (FAQ_HEADING.test(blockText(block).trim())) inFaq = true
      continue
    }
    if (!inFaq) continue

    if (block.style === 'h3') {
      flush()
      question = blockText(block).trim() || null
    } else if (question && (block.style === 'normal' || !block.style || block.listItem)) {
      const text = blockText(block).trim()
      if (text) answerParts.push(text)
    }
  }
  flush()

  return items
}
