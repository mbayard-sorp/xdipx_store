export interface TaxonomyTag {
  tag: string
  label: string
}

export interface TaxonomyGroup {
  id: string
  label: string
  tags: TaxonomyTag[]
  defaultExpanded?: boolean
}

export const CSV_HEADERS = ['group_id', 'group_label', 'default_expanded', 'tag', 'tag_label'] as const

function escapeCell(value: string): string {
  if (value === '') return ''
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function row(cells: string[]): string {
  return cells.map(escapeCell).join(',')
}

export function taxonomyToCSV(groups: TaxonomyGroup[]): string {
  const lines: string[] = [CSV_HEADERS.join(',')]
  for (const g of groups) {
    const de = g.defaultExpanded === false ? 'false' : 'true'
    if (g.tags.length === 0) {
      lines.push(row([g.id, g.label, de, '', '']))
      continue
    }
    for (const t of g.tags) {
      lines.push(row([g.id, g.label, de, t.tag, t.label]))
    }
  }
  return lines.join('\n') + '\n'
}

export function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
