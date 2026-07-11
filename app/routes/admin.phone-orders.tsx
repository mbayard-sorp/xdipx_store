import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { desc } from 'drizzle-orm'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { draftOrders } from '~/../db/schema'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'

export const meta: MetaFunction = () => [{ title: 'Phone Orders — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const rows = await db
    .select()
    .from(draftOrders)
    .orderBy(desc(draftOrders.createdAt))
    .limit(100)
  return { rows }
}

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function AdminPhoneOrders() {
  const { rows } = useLoaderData<typeof loader>()
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <h1 className="font-display text-2xl mb-4">Phone & SMS orders</h1>
      <p className="text-sm text-ink/70 mb-4">
        Draft orders created via IVR / SMS. Payment happens in Shopify checkout — watch the Shopify admin for paid state.
      </p>
      {rows.length === 0 ? (
        <p className="text-ink/60">No draft orders yet.</p>
      ) : (
        <ResponsiveTable>
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Channel</th>
                <th className="py-2 pr-3">Phone</th>
                <th className="py-2 pr-3">Customer</th>
                <th className="py-2 pr-3">Items</th>
                <th className="py-2 pr-3 text-right">Subtotal</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="py-2 pr-3 uppercase text-xs">{r.channel}</td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    <a href={`tel:${r.phone}`} className="text-sage">{r.phone}</a>
                  </td>
                  <td className="py-2 pr-3">
                    <div>{r.customerName ?? '—'}</div>
                    <div className="text-xs text-ink/60">{r.email ?? ''}</div>
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {(r.lineItems ?? []).map((li, i) => (
                      <div key={i}>{li.quantity}× {li.title}</div>
                    ))}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{fmtCents(r.subtotalCents)}</td>
                  <td className="py-2 pr-3">{r.status}</td>
                  <td className="py-2 pr-3">
                    {r.shopifyInvoiceUrl ? (
                      <a href={r.shopifyInvoiceUrl} target="_blank" rel="noreferrer" className="text-coral underline">
                        open
                      </a>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      )}
    </div>
  )
}
