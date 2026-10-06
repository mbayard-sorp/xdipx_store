/**
 * Google Ads offline-conversion export (tickets #3422/#3535).
 *
 * `google_click_conversions` (migration 117) is written best-effort by
 * `server/webhooks.ts` on `orders/create` from the `_gclid`/`_gclid_type`
 * cart attributes `attribution-cart.server.ts` stamps. This file is the
 * read side: the admin export route pulls every not-yet-exported row,
 * renders it in Google's offline-conversion-import CSV shape, and marks the
 * batch exported so a later export never re-sends the same conversion.
 *
 * Column reference (Google Ads > Tools > Conversions > Uploads > offline
 * conversion import by Google Click ID): "Google Click ID" is populated
 * only for a `gclid`; a `gbraid`/`wbraid` upload instead, in its own named
 * column, per Google's iOS-SKAdNetwork click-id docs — mixing them into one
 * column silently drops the row at import.
 */
import { isNull } from 'drizzle-orm'
import { db } from './db.server'
import { googleClickConversions } from '../../db/schema'

export interface GoogleClickConversionRow {
  id: number
  orderId: string
  gclid: string
  gclidType: string
  value: string
  currency: string
  clickTime: Date
  orderTime: Date
}

/** Every conversion not yet included in an export batch, oldest first. */
export async function getUnexportedGoogleClickConversions(): Promise<GoogleClickConversionRow[]> {
  const rows = await db.select().from(googleClickConversions)
    .where(isNull(googleClickConversions.exportedAt))
    .orderBy(googleClickConversions.createdAt)
  return rows
}

/** Stamp a batch exported so it is never re-sent. */
export async function markGoogleClickConversionsExported(ids: number[]): Promise<void> {
  if (ids.length === 0) return
  const { inArray } = await import('drizzle-orm')
  await db.update(googleClickConversions)
    .set({ exportedAt: new Date() })
    .where(inArray(googleClickConversions.id, ids))
}

/** Google's required timestamp shape: "yyyy-MM-dd HH:mm:ss+00:00" (UTC). */
function googleConversionTime(d: Date): string {
  const iso = d.toISOString() // 2026-10-05T14:30:00.000Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00:00`
}

function csvEscape(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

// NOTE ON VERIFICATION (same flag PR #678 raised for the GA4 field names):
// this header mirrors Google Ads' documented offline-conversion-import
// template (Tools > Conversions > Uploads > "Google Click ID" template —
// Google Click ID / GBRAID / WBRAID as three separate optional id columns,
// then Conversion Name / Conversion Time / Conversion Value / Conversion
// Currency Code), but this session had no live Google Ads account to
// cross-check an actual template download against. Verify one real upload
// against a sandbox/test conversion action before relying on this for a
// real spend decision.
export const GOOGLE_ADS_CSV_HEADER =
  'Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency Code'

/**
 * One CSV row per conversion, in Google's offline-conversion-import column
 * order. `conversionName` must match a conversion action already configured
 * in Google Ads; it rides as a parameter rather than a stored column because
 * it is an Ads-account setting, not a fact about the order.
 */
export function googleClickConversionToCSVRow(row: GoogleClickConversionRow, conversionName: string): string {
  const gclidCol  = row.gclidType === 'gclid'  ? row.gclid : ''
  const gbraidCol = row.gclidType === 'gbraid' ? row.gclid : ''
  const wbraidCol = row.gclidType === 'wbraid' ? row.gclid : ''
  return [
    csvEscape(gclidCol),
    csvEscape(gbraidCol),
    csvEscape(wbraidCol),
    csvEscape(conversionName),
    csvEscape(googleConversionTime(row.orderTime)),
    row.value,
    csvEscape(row.currency),
  ].join(',')
}
