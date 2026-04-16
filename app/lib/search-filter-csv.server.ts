import { parse } from 'csv-parse/sync'
import { slugify, type TaxonomyGroup, type TaxonomyTag } from './search-filter-csv'

interface Row {
  group_id?: string
  group_label?: string
  default_expanded?: string
  tag?: string
  tag_label?: string
}

export function taxonomyFromCSV(csv: string): { groups: TaxonomyGroup[]; errors: string[] } {
  const errors: string[] = []
  let rows: Row[]
  try {
    rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as Row[]
  } catch (err) {
    return { groups: [], errors: [`CSV parse error: ${(err as Error).message}`] }
  }

  if (rows.length === 0) {
    return { groups: [], errors: ['CSV is empty'] }
  }

  const first = rows[0]!
  const hasRequiredCols = 'group_label' in first && 'tag' in first && 'tag_label' in first
  if (!hasRequiredCols) {
    errors.push('CSV must have header row with columns: group_id, group_label, default_expanded, tag, tag_label')
    return { groups: [], errors }
  }

  const byKey = new Map<string, TaxonomyGroup>()
  const order: string[] = []

  rows.forEach((r, i) => {
    const lineNo = i + 2 // +1 for header, +1 for 1-based
    const groupLabel = (r.group_label ?? '').trim()
    if (!groupLabel) {
      errors.push(`Row ${lineNo}: group_label is required`)
      return
    }

    const groupId = (r.group_id ?? '').trim() || slugify(groupLabel)
    if (!groupId) {
      errors.push(`Row ${lineNo}: could not derive group_id from label "${groupLabel}"`)
      return
    }

    let group = byKey.get(groupId)
    if (!group) {
      const deRaw = (r.default_expanded ?? '').trim().toLowerCase()
      let defaultExpanded: boolean | undefined
      if (deRaw === '' || deRaw === 'true') defaultExpanded = true
      else if (deRaw === 'false') defaultExpanded = false
      else {
        errors.push(`Row ${lineNo}: default_expanded must be "true", "false", or blank (got "${r.default_expanded}")`)
        defaultExpanded = true
      }
      group = { id: groupId, label: groupLabel, tags: [], defaultExpanded }
      byKey.set(groupId, group)
      order.push(groupId)
    } else if (group.label !== groupLabel) {
      errors.push(`Row ${lineNo}: group_id "${groupId}" already used with label "${group.label}" — got "${groupLabel}"`)
    }

    const tag = (r.tag ?? '').trim()
    const tagLabel = (r.tag_label ?? '').trim()
    if (tag === '' && tagLabel === '') return // group-only row
    if (!tag || !tagLabel) {
      errors.push(`Row ${lineNo}: tag and tag_label are both required (or both blank for group-only row)`)
      return
    }
    const tagRecord: TaxonomyTag = { tag, label: tagLabel }
    group.tags.push(tagRecord)
  })

  const groups = order.map(id => byKey.get(id)!)
  return { groups, errors }
}
