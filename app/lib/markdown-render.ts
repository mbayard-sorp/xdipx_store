/**
 * Tiny inline markdown renderer for Emma Chat assistant messages.
 * Client-safe — no .server suffix.
 *
 * Handles only the subset Emma emits:
 *   **bold** → <strong>
 *   *italic* → <em>
 *   [text](url) → <a> (http/https only)
 *   \n\n → paragraph break
 *   \n → <br>
 *   - item lines → <ul><li>
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Render inline markdown (bold, italic, links) inside a block of text. */
function renderInline(text: string): string {
  // Process links first to avoid interfering with bold/italic inside link text
  // [text](url) — allow only http/https
  let out = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    (_, linkText, url) =>
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkText)}</a>`,
  )
  // **bold**
  out = out.replace(/\*\*(.+?)\*\*/gs, (_, inner) => `<strong>${inner}</strong>`)
  // *italic* (not preceded/followed by *)
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/gs, (_, inner) => `<em>${inner}</em>`)
  return out
}

/**
 * Render a block of markdown text to an HTML string.
 * Returns sanitized HTML safe to set via dangerouslySetInnerHTML.
 * The result is intentionally minimal — admin-internal only.
 */
export function renderMarkdown(source: string): string {
  const paragraphs = source.split(/\n\n+/)
  const rendered = paragraphs.map(para => {
    const lines = para.split('\n')
    // Bullet list: ALL lines in paragraph start with "- "
    if (lines.length > 0 && lines.every(l => /^-\s/.test(l))) {
      const items = lines
        .map(l => `<li>${renderInline(escapeHtml(l.replace(/^-\s/, '')))}</li>`)
        .join('')
      return `<ul class="list-disc pl-5 space-y-1">${items}</ul>`
    }
    // Mixed list: some lines start with "- ", others don't
    const hasBullets = lines.some(l => /^-\s/.test(l))
    if (hasBullets) {
      const parts: string[] = []
      let listItems: string[] = []
      const flushList = () => {
        if (listItems.length > 0) {
          parts.push(`<ul class="list-disc pl-5 space-y-1">${listItems.join('')}</ul>`)
          listItems = []
        }
      }
      for (const line of lines) {
        if (/^-\s/.test(line)) {
          listItems.push(`<li>${renderInline(escapeHtml(line.replace(/^-\s/, '')))}</li>`)
        } else {
          flushList()
          if (line.trim()) parts.push(`<p>${renderInline(escapeHtml(line))}</p>`)
        }
      }
      flushList()
      return parts.join('')
    }
    // Normal paragraph — join lines with <br> for single newlines
    const inner = lines
      .map(l => renderInline(escapeHtml(l)))
      .join('<br>')
    return `<p>${inner}</p>`
  })
  return rendered.join('')
}
