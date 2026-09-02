/**
 * pricing-report.server.ts
 *
 * Builds the daily pricing agent report: structured JSON, HTML email body,
 * optional Haiku narrative, and Zoho SMTP delivery.
 */

import { generateWithSystem } from './claude.server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PricingChangeRecord {
  id: number
  runDate: string
  sku: string
  productId: string
  productHandle: string | null
  productTitle: string | null
  variantId: string
  variantTitle: string | null
  vendor: string | null
  tier: string
  oldPrice: number | null
  newPrice: number
  oldCompareAt: number | null
  newCompareAt: number | null
  marginPct: number | null
  mapPrice: number | null
  reason: string
  mapRespected: boolean
  status: 'pending' | 'auto_applied' | 'approved' | 'rejected' | 'failed' | 'skipped_dry_run'
}

export interface PricingReport {
  runDate: string
  generatedAt: string
  totalChanges: number
  autoApplied: number
  pending: number
  failed: number
  sections: {
    newSales: PricingChangeRecord[]
    priceDrops: PricingChangeRecord[]
    increasesAbsorbed: PricingChangeRecord[]
    mapViolationsAverted: PricingChangeRecord[]
    marginWarnings: PricingChangeRecord[]
    pending: PricingChangeRecord[]
  }
  narrative?: string
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

export function buildPricingReport(
  records: PricingChangeRecord[],
  runDate: string,
): PricingReport {
  const autoApplied = records.filter(
    (r) => r.status === 'auto_applied' || r.status === 'skipped_dry_run',
  ).length
  const pending = records.filter((r) => r.status === 'pending').length
  const failed = records.filter((r) => r.status === 'failed').length

  const newSales = records.filter((r) => r.tier === 'sale-flow-through')

  const priceDrops = records.filter(
    (r) =>
      r.oldPrice != null &&
      r.newPrice < r.oldPrice &&
      r.tier !== 'sale-flow-through',
  )

  const increasesAbsorbed = records.filter((r) => {
    const absorbed =
      r.reason.toLowerCase().includes('absorbed') ||
      r.reason.toLowerCase().includes('no change')
    return absorbed
  })

  const mapViolationsAverted = records.filter(
    (r) =>
      r.mapRespected === true &&
      r.mapPrice != null &&
      r.oldPrice != null &&
      r.oldPrice < r.mapPrice,
  )

  const marginWarnings = records.filter(
    (r) => r.tier === 'thin-margin' || (r.marginPct != null && r.marginPct < 0.2),
  )

  const pendingRecords = records.filter((r) => r.status === 'pending')

  return {
    runDate,
    generatedAt: new Date().toISOString(),
    totalChanges: records.length,
    autoApplied,
    pending,
    failed,
    sections: {
      newSales,
      priceDrops,
      increasesAbsorbed,
      mapViolationsAverted,
      marginWarnings,
      pending: pendingRecords,
    },
  }
}

// ---------------------------------------------------------------------------
// Narrative via Haiku
// ---------------------------------------------------------------------------

function top5Interesting(report: PricingReport): PricingChangeRecord[] {
  const seen = new Set<number>()
  const candidates: PricingChangeRecord[] = []

  const addUniq = (r: PricingChangeRecord) => {
    if (!seen.has(r.id)) {
      seen.add(r.id)
      candidates.push(r)
    }
  }

  report.sections.mapViolationsAverted.forEach(addUniq)

  const biggestDrops = [...report.sections.priceDrops]
    .sort((a, b) => {
      const dropA = (a.oldPrice ?? 0) - a.newPrice
      const dropB = (b.oldPrice ?? 0) - b.newPrice
      return dropB - dropA
    })
    .slice(0, 3)
  biggestDrops.forEach(addUniq)

  report.sections.newSales.forEach(addUniq)

  return candidates.slice(0, 5)
}

export async function generateNarrative(report: PricingReport): Promise<string | null> {
  const model = process.env['PRICING_NARRATIVE_MODEL'] ?? 'none'
  if (model === 'none' || !model) return null

  const top5 = top5Interesting(report)

  const top5Lines = top5
    .map((r) => {
      const title = r.productTitle ?? r.sku
      const drop =
        r.oldPrice != null ? ` (was $${r.oldPrice.toFixed(2)}, now $${r.newPrice.toFixed(2)})` : ''
      return `- ${title}${drop}: ${r.reason}`
    })
    .join('\n')

  const user = [
    `Run date: ${report.runDate}`,
    `Total SKUs evaluated: ${report.totalChanges}`,
    `Auto-applied: ${report.autoApplied}, Pending review: ${report.pending}, Failed: ${report.failed}`,
    `MAP corrections: ${report.sections.mapViolationsAverted.length}`,
    `New sale flow-throughs: ${report.sections.newSales.length}`,
    `Margin warnings: ${report.sections.marginWarnings.length}`,
    '',
    'Top changes:',
    top5Lines || '(none)',
    '',
    'Write 2-3 sentences in neutral ops tone (not Emma voice). Summarize what happened. Be specific about notable items.',
  ].join('\n')

  try {
    const text = await generateWithSystem({
      system:
        'You are a pricing operations analyst. Write factual, concise summaries for internal ops emails. No em-dashes. Plain sentences.',
      user,
      model,
      maxTokens: 200,
      caller: 'pricing-report',
    })
    return text.trim()
  } catch (err) {
    console.warn('[pricing-report] narrative generation failed:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// HTML email renderer
// ---------------------------------------------------------------------------

const CELL = 'padding:6px 10px;border-bottom:1px solid #e5dbc9;font-size:13px;color:#2a2421;font-family:Inter,sans-serif;'
const TH = 'padding:6px 10px;background:#faf4ea;font-size:12px;font-weight:600;color:#6f645c;font-family:Inter,sans-serif;text-align:left;border-bottom:2px solid #e5dbc9;'

function fmtPrice(v: number | null): string {
  if (v == null) return '-'
  return `$${v.toFixed(2)}`
}

function fmtPct(v: number | null): string {
  if (v == null) return '-'
  return `${(v * 100).toFixed(1)}%`
}

function sectionTable(records: PricingChangeRecord[]): string {
  if (records.length === 0) return ''

  const rows = records
    .map((r) => {
      const title = r.productTitle ?? r.sku
      const variant = r.variantTitle ? ` (${r.variantTitle})` : ''
      const oldNew = `${fmtPrice(r.oldPrice)} &rarr; ${fmtPrice(r.newPrice)}`
      const cmpOldNew = `${fmtPrice(r.oldCompareAt)} &rarr; ${fmtPrice(r.newCompareAt)}`
      return `
        <tr>
          <td style="${CELL}">${title}${variant}</td>
          <td style="${CELL}">${r.vendor ?? '-'}</td>
          <td style="${CELL};font-family:monospace;">${r.sku}</td>
          <td style="${CELL}">${oldNew}</td>
          <td style="${CELL}">${cmpOldNew}</td>
          <td style="${CELL}">${fmtPct(r.marginPct)}</td>
          <td style="${CELL}">${r.reason}</td>
        </tr>`
    })
    .join('')

  return `
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-bottom:24px;">
      <thead>
        <tr>
          <th style="${TH}">Product</th>
          <th style="${TH}">Vendor</th>
          <th style="${TH}">SKU</th>
          <th style="${TH}">Old &rarr; New</th>
          <th style="${TH}">Compare-at</th>
          <th style="${TH}">Margin%</th>
          <th style="${TH}">Reason</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`
}

function sectionBlock(title: string, records: PricingChangeRecord[], extra = ''): string {
  if (records.length === 0) return ''
  return `
    <h2 style="font-family:Inter,sans-serif;font-size:15px;font-weight:700;color:#151211;margin:24px 0 8px;">${title} <span style="font-weight:400;color:#6f645c;">(${records.length})</span></h2>
    ${extra}
    ${sectionTable(records)}`
}

export function renderPricingReportHTML(report: PricingReport, adminUrl: string): string {
  const { sections, runDate, generatedAt, totalChanges, pending, autoApplied, failed } = report

  const narrativeBlock = report.narrative
    ? `<div style="background:#faf4ea;border-left:4px solid #ff4b1f;padding:14px 18px;margin-bottom:28px;font-family:Inter,sans-serif;font-size:14px;color:#2a2421;line-height:1.6;">${report.narrative}</div>`
    : ''

  const reviewLink = `<a href="${adminUrl}/admin/pricing" style="color:#ff4b1f;font-weight:600;font-family:Inter,sans-serif;font-size:13px;">Review in admin &rarr;</a>`

  const body = [
    sectionBlock('New sales detected', sections.newSales),
    sectionBlock('Price drops auto-applied', sections.priceDrops),
    sectionBlock('Price increases absorbed', sections.increasesAbsorbed),
    sectionBlock('MAP violations averted', sections.mapViolationsAverted),
    sectionBlock('Margin warnings / thin-tier flags', sections.marginWarnings),
    sectionBlock('Pending approval', sections.pending, reviewLink),
  ]
    .filter(Boolean)
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2eadd;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f2eadd;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table cellpadding="0" cellspacing="0" border="0" width="640" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:640px;width:100%;">
          <tr>
            <td style="background:#151211;padding:20px 28px;">
              <span style="font-family:Inter,sans-serif;font-size:18px;font-weight:700;color:#ffffff;">xdipx pricing</span>
              <span style="font-family:Inter,sans-serif;font-size:14px;color:#6f645c;margin-left:12px;">${totalChanges} changes, ${pending} pending review &middot; ${runDate}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${narrativeBlock}
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
                <tr>
                  <td style="font-family:Inter,sans-serif;font-size:13px;color:#6f645c;padding:8px 10px;background:#faf4ea;border-radius:6px;">
                    Auto-applied: <strong style="color:#151211;">${autoApplied}</strong>
                    &nbsp;&nbsp;|&nbsp;&nbsp;
                    Pending: <strong style="color:#ff4b1f;">${pending}</strong>
                    &nbsp;&nbsp;|&nbsp;&nbsp;
                    Failed: <strong style="color:#d93a15;">${failed}</strong>
                  </td>
                </tr>
              </table>
              ${body || '<p style="font-family:Inter,sans-serif;font-size:14px;color:#6f645c;">No pricing changes recorded for this run.</p>'}
            </td>
          </tr>
          <tr>
            <td style="background:#faf4ea;padding:16px 28px;border-top:1px solid #e5dbc9;">
              <p style="font-family:Inter,sans-serif;font-size:11px;color:#6f645c;margin:0;">
                Generated ${new Date(generatedAt).toUTCString()} &middot; Auto-generated by daily pricing agent. Tone: ops, not customer.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Email send via Zoho SMTP
// ---------------------------------------------------------------------------

export async function sendPricingReportEmail(
  report: PricingReport,
  opts: { adminUrl?: string } = {},
): Promise<{ sent: boolean; error?: string }> {
  const adminUrl = opts.adminUrl ?? 'https://xdipx.com'
  const html = renderPricingReportHTML(report, adminUrl)
  const subject = `xdipx pricing: ${report.totalChanges} changes, ${report.pending} pending review (${report.runDate})`
  const { sendOwnerEmail } = await import('~/lib/owner-alerts.server')
  return sendOwnerEmail(subject, html, { escalation: 'pricing-report', fromName: 'xdipx pricing agent' })
}
