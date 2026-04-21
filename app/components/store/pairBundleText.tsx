export function splitUnderscores(body: string): Array<{ text: string; emph: boolean }> {
  const parts = body.split(/(_[^_]+_)/g)
  return parts.map(part => {
    if (part.startsWith('_') && part.endsWith('_')) return { text: part.slice(1, -1), emph: true }
    return { text: part, emph: false }
  })
}

export function renderWithHighlight(body: string, coralClass = 'text-coral') {
  return splitUnderscores(body).map((p, i) =>
    p.emph
      ? <span key={i} className={coralClass}>{p.text}</span>
      : <span key={i}>{p.text}</span>,
  )
}
