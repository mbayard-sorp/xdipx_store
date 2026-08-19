/**
 * GET /api/team/conversion-status
 *
 * Unresolved-count + oldest-age for the two revenue-conversion retry queues
 * (meta_capi_failures, ga4_purchase_failures), so the daily QA gate
 * (docs/store-team/routine-qa-daily.md Step 6 sub-check (1)) can verify them
 * without a direct DB connection. A cloud QA session's egress is restricted
 * to xdipx.com, so a raw psql to DATABASE_URL just hangs; this route is the
 * xdipx.com-reachable substitute. Team-token auth required.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { isNull, sql } from 'drizzle-orm'
import { assertTeamAuth } from '~/lib/team.server'
import { db } from '~/lib/db.server'
import { ga4PurchaseFailures, metaCapiFailures } from '../../db/schema'

interface UnresolvedRow {
  count: number
  oldestHours: number | null
}

async function unresolvedStats(
  table: typeof metaCapiFailures | typeof ga4PurchaseFailures,
): Promise<UnresolvedRow> {
  const rows = await db
    .select({
      count: sql<number>`count(*)::int`,
      oldestHours: sql<number | null>`extract(epoch from (now() - min(${table.createdAt}))) / 3600`,
    })
    .from(table)
    .where(isNull(table.resolvedAt))

  const row = rows[0]
  return {
    count: row?.count ?? 0,
    oldestHours: row?.oldestHours != null ? Number(row.oldestHours) : null,
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)

  const [metaCapi, ga4] = await Promise.all([
    unresolvedStats(metaCapiFailures),
    unresolvedStats(ga4PurchaseFailures),
  ])

  return Response.json(
    {
      metaCapiUnresolvedCount: metaCapi.count,
      metaCapiOldestAgeHours: metaCapi.oldestHours,
      ga4UnresolvedCount: ga4.count,
      ga4OldestAgeHours: ga4.oldestHours,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
