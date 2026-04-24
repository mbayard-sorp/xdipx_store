import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useOutletContext } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { adminGetCustomerSubscriptions } from '~/lib/shopify.server'
import { SubscriptionContractCard } from '~/components/account/SubscriptionContractCard'
import { EmptyState } from '~/components/account/EmptyState'
import type { AccountOutletContext } from './_layout.account'

export const meta: MetaFunction = () => [{ title: 'Subscriptions — xdipx' }]

export async function loader({ request }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })

  const profile = await api.getProfile()
  if (!profile) {
    throw new Response('Unauthorized', { status: 401 })
  }

  const subscriptions = await adminGetCustomerSubscriptions(profile.id)

  return { subscriptions }
}

export default function SubscriptionsList() {
  const { subscriptions } = useLoaderData<typeof loader>()
  const { customer } = useOutletContext<AccountOutletContext>()

  return (
    <div className="space-y-6">
      {/* Desktop heading (mobile sub-header already shows "Subscriptions") */}
      <section className="hidden lg:block">
        <h1
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Subscriptions <span className="text-sage">♥</span>
        </h1>
        <p className="text-sm text-ink/50 mt-0.5">
          {customer.email}
        </p>
      </section>

      {/* Subscriptions list / empty state */}
      {subscriptions.length === 0 ? (
        <EmptyState
          title="No subscriptions yet ♥"
          description="When you subscribe to a product, it will show up here so you can track deliveries."
          cta={{ label: "Browse today's deal ♥", to: '/' }}
        />
      ) : (
        <ul className="space-y-3">
          {subscriptions.map((contract) => (
            <li key={contract.id}>
              <SubscriptionContractCard contract={contract} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
