export interface DealOrderRow {
  dealId: number
  sku: string
  seoTitle: string
  dealDate: string
  status: string
  sortOrder: number
}

export const DEAL_ORDER_CSV_HEADERS = [
  'deal_id',
  'sku',
  'seo_title',
  'deal_date',
  'status',
  'sort_order',
] as const

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

export function dealOrderToCSV(rows: DealOrderRow[]): string {
  const lines: string[] = [DEAL_ORDER_CSV_HEADERS.join(',')]
  for (const r of rows) {
    lines.push(row([
      String(r.dealId),
      r.sku ?? '',
      r.seoTitle ?? '',
      r.dealDate ?? '',
      r.status ?? '',
      String(r.sortOrder ?? 0),
    ]))
  }
  return lines.join('\n') + '\n'
}
