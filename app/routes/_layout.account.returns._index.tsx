import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useLoaderData, useOutletContext } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { listCustomerReturns, rmaNumber } from '~/lib/returns.server'
import { ReturnStatusPill } from '~/components/account/ReturnStatusPill'
import { EmptyState } from '~/components/account/EmptyState'
import type { AccountOutletContext } from './_layout.account'

export const meta: MetaFunction = () => [{ title: 'Returns — xdipx' }]

export async function loader({ request }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })
  const customer = await api.getProfile()
  if (!customer) {
    return { returns: [] }
  }
  const rows = await listCustomerReturns(customer.id)
  // Sort newest first (Drizzle default is ascending by createdAt).
  return {
    returns: rows.slice().reverse().map(r => ({
      id: r.id,
      rma: rmaNumber(r.shopifyReturnId),
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      itemCount: r.lineItems.length,
      refundAmountCents: r.refundAmountCents,
    })),
  }
}

export default function ReturnsList() {
  const { returns } = useLoaderData<typeof loader>()
  useOutletContext<AccountOutletContext>()

  if (returns.length === 0) {
    return (
      <div className="space-y-6">
        <Heading />
        <EmptyState
          title="No returns yet ♥"
          description="Need to send something back? Start a return from any eligible order."
          cta={{ label: 'View orders', to: '/account/orders' }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Heading />
      <ul className="space-y-3">
        {returns.map(r => (
          <li key={r.id}>
            <Link
              to={`/account/returns/${r.id}`}
              className="block bg-white border border-cream-2 rounded-2xl p-4 md:p-5 hover:border-sage/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p
                    className="text-sm font-bold text-ink"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {r.rma}
                  </p>
                  <p className="text-xs text-ink/50 mt-0.5">
                    {new Date(r.createdAt).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                    {' · '}
                    {r.itemCount} item{r.itemCount === 1 ? '' : 's'}
                  </p>
                  <div className="mt-2">
                    <ReturnStatusPill status={r.status} />
                  </div>
                </div>
                {r.refundAmountCents != null && (
                  <p className="text-sm font-semibold text-ink tabular-nums shrink-0">
                    ${(r.refundAmountCents / 100).toFixed(2)}
                  </p>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Heading() {
  return (
    <section className="hidden lg:block">
      <h1
        className="text-2xl font-bold text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Returns <span className="text-sage">♥</span>
      </h1>
      <p className="text-sm text-ink/50 mt-0.5">
        Track refunds and print return labels.
      </p>
    </section>
  )
}
