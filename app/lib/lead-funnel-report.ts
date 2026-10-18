/**
 * Pure aggregation for the paid lead funnel attribution report (ticket #16145).
 * Client-safe: no server imports. Fetching lives in lead-funnel-report.server.ts.
 *
 * A lead "converts" when the same Klaviyo profile has a Placed Order event
 * strictly after lead_captured_at. Orders placed before capture never count.
 */

export const UNSET = '(not set)'

export interface FunnelLead {
  profileId: string
  utmContent: string | null
  interest: string | null
  /** ISO timestamp from the lead_captured_at profile property. */
  capturedAt: string
}

export interface FunnelOrder {
  profileId: string
  /** ISO timestamp of the Placed Order event. */
  at: string
  value: number
}

export interface FunnelRow {
  key: string
  leads: number
  convertedLeads: number
  orders: number
  revenue: number
  /** convertedLeads / leads, 0 when there are no leads. */
  leadToOrderRate: number
}

export interface FunnelAggregate {
  totals: FunnelRow
  byUtmContent: FunnelRow[]
  byInterest: FunnelRow[]
}

interface Acc {
  leads: number
  convertedLeads: number
  orders: number
  revenue: number
}

function finish(key: string, a: Acc): FunnelRow {
  return {
    key,
    leads: a.leads,
    convertedLeads: a.convertedLeads,
    orders: a.orders,
    revenue: Math.round(a.revenue * 100) / 100,
    leadToOrderRate: a.leads > 0 ? a.convertedLeads / a.leads : 0,
  }
}

function bump(map: Map<string, Acc>, key: string, orders: number, revenue: number) {
  const a = map.get(key) ?? { leads: 0, convertedLeads: 0, orders: 0, revenue: 0 }
  a.leads += 1
  if (orders > 0) a.convertedLeads += 1
  a.orders += orders
  a.revenue += revenue
  map.set(key, a)
}

function sorted(map: Map<string, Acc>): FunnelRow[] {
  return [...map.entries()]
    .map(([k, a]) => finish(k, a))
    .sort((x, y) => y.leads - x.leads || x.key.localeCompare(y.key))
}

export function aggregateLeadFunnel(
  leads: FunnelLead[],
  orders: FunnelOrder[],
  window: { start: Date; end?: Date },
): FunnelAggregate {
  const startMs = window.start.getTime()
  const endMs = (window.end ?? new Date(8.64e15)).getTime()

  const ordersByProfile = new Map<string, FunnelOrder[]>()
  for (const o of orders) {
    const list = ordersByProfile.get(o.profileId) ?? []
    list.push(o)
    ordersByProfile.set(o.profileId, list)
  }

  const byContent = new Map<string, Acc>()
  const byInterest = new Map<string, Acc>()
  const total = new Map<string, Acc>()

  for (const lead of leads) {
    const capMs = Date.parse(lead.capturedAt)
    if (!Number.isFinite(capMs) || capMs < startMs || capMs > endMs) continue
    let n = 0
    let revenue = 0
    for (const o of ordersByProfile.get(lead.profileId) ?? []) {
      const at = Date.parse(o.at)
      if (Number.isFinite(at) && at > capMs) {
        n += 1
        revenue += Number.isFinite(o.value) ? o.value : 0
      }
    }
    bump(byContent, lead.utmContent?.trim() || UNSET, n, revenue)
    bump(byInterest, lead.interest?.trim() || UNSET, n, revenue)
    bump(total, 'all', n, revenue)
  }

  return {
    totals: finish('all', total.get('all') ?? { leads: 0, convertedLeads: 0, orders: 0, revenue: 0 }),
    byUtmContent: sorted(byContent),
    byInterest: sorted(byInterest),
  }
}
