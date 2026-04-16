import { parse } from 'csv-parse/sync'

interface Row {
  deal_id?: string
  sort_order?: string
}

export interface ParsedDealOrder {
  id: number
  sortOrder: number
}

export function dealOrderFromCSV(csv: string): { orders: ParsedDealOrder[]; errors: string[] } {
  const errors: string[] = []
  let rows: Row[]
  try {
    rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as Row[]
  } catch (err) {
    return { orders: [], errors: [`CSV parse error: ${(err as Error).message}`] }
  }

  if (rows.length === 0) {
    return { orders: [], errors: ['CSV is empty'] }
  }

  const first = rows[0]!
  if (!('deal_id' in first) || !('sort_order' in first)) {
    return {
      orders: [],
      errors: ['CSV must have header row including columns: deal_id, sort_order'],
    }
  }

  const seen = new Set<number>()
  const orders: ParsedDealOrder[] = []

  rows.forEach((r, i) => {
    const lineNo = i + 2
    const idRaw = (r.deal_id ?? '').trim()
    const sortRaw = (r.sort_order ?? '').trim()

    if (!idRaw) {
      errors.push(`Row ${lineNo}: deal_id is required`)
      return
    }
    const id = Number(idRaw)
    if (!Number.isInteger(id) || id <= 0) {
      errors.push(`Row ${lineNo}: deal_id must be a positive integer (got "${idRaw}")`)
      return
    }
    if (seen.has(id)) {
      errors.push(`Row ${lineNo}: duplicate deal_id ${id}`)
      return
    }
    seen.add(id)

    const sortOrder = Number(sortRaw)
    if (!Number.isInteger(sortOrder)) {
      errors.push(`Row ${lineNo}: sort_order must be an integer (got "${sortRaw}")`)
      return
    }

    orders.push({ id, sortOrder })
  })

  return { orders, errors }
}
