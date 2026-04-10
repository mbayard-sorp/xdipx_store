import { useState } from 'react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, redirect, useActionData, useFetcher, useLoaderData, useOutletContext } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { AddressCard } from '~/components/account/AddressCard'
import { ConfirmDialog } from '~/components/account/ConfirmDialog'
import { EmptyState } from '~/components/account/EmptyState'
import type { AccountOutletContext } from './_layout.account'

export const meta: MetaFunction = () => [{ title: 'Addresses — xdipx' }]

// ── Loader ───────────────────────────────────────────────────────────────────
//
// We do a fresh getAddresses() call here (rather than relying solely on the
// outlet context's cached addresses) so that the list immediately reflects
// any add/edit/delete that just happened. React Router revalidates this loader
// after every action in this route, so the list is always fresh.
//
export async function loader({ request }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })
  const addresses = await api.getAddresses()
  return { addresses, tokenType }
}

// ── Action ───────────────────────────────────────────────────────────────────
export async function action({ request }: ActionFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const api = customerAPI({ token, tokenType })
  const form = await request.formData()
  const intent = form.get('intent') as string
  const id     = form.get('id') as string

  if (!id) return { error: 'Missing address id.' }

  if (intent === 'delete') {
    const result = await api.deleteAddress(id)
    if ('error' in result) return { error: result.error }
    // Redirect after delete so the loader re-runs cleanly
    throw redirect('/account/addresses')
  }

  if (intent === 'set-default') {
    const result = await api.setDefaultAddress(id)
    if ('error' in result) return { error: result.error }
    // Redirect after set-default so the outlet context re-fetches too
    throw redirect('/account/addresses')
  }

  return { error: 'Unknown intent.' }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AddressesPage() {
  const { addresses, tokenType } = useLoaderData<typeof loader>()
  const { customer } = useOutletContext<AccountOutletContext>()
  const actionData = useActionData<typeof action>()
  const fetcher = useFetcher()

  // Track which address the user wants to delete — drives the confirm dialog
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  // Close the dialog when the fetcher returns to idle after a delete
  const isDeleting = fetcher.state !== 'idle'

  function handleDeleteConfirm() {
    if (!deleteTargetId) return
    fetcher.submit({ intent: 'delete', id: deleteTargetId }, { method: 'post' })
    setDeleteTargetId(null)
  }

  function handleSetDefault(id: string) {
    fetcher.submit({ intent: 'set-default', id }, { method: 'post' })
  }

  // Sort: default first, then by id ascending
  const sorted = [...addresses].sort((a, b) => {
    if (a.id === customer.defaultAddressId) return -1
    if (b.id === customer.defaultAddressId) return 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return (
    <div className="space-y-6">
      {/* Desktop heading (mobile sub-header already shows "Addresses") */}
      <section className="hidden lg:flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold text-brand-charcoal"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Addresses <span className="text-brand-purple">♥</span>
          </h1>
          <p className="text-sm text-brand-charcoal/50 mt-0.5">{customer.email}</p>
        </div>
        {tokenType !== 'account' && (
          <Link
            to="/account/addresses/new"
            className="text-sm font-semibold text-white bg-brand-gradient px-4 py-2 rounded-full hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            + Add address
          </Link>
        )}
      </section>

      {/* Mobile "+ Add" button */}
      {tokenType !== 'account' && (
        <div className="flex justify-end lg:hidden">
          <Link
            to="/account/addresses/new"
            className="text-sm font-semibold text-white bg-brand-gradient px-4 py-2 rounded-full hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            + Add address
          </Link>
        </div>
      )}

      {/* Action error (non-delete errors come back via actionData) */}
      {actionData && 'error' in actionData && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {actionData.error}
        </div>
      )}

      {/* Shop OAuth notice — address management not available for account-API sessions */}
      {tokenType === 'account' ? (
        <div className="bg-white border border-brand-mist rounded-2xl px-6 py-8 text-center space-y-3">
          <p
            className="text-base font-semibold text-brand-charcoal"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Address management isn't available for Shop-login sessions yet <span className="text-brand-purple">♥</span>
          </p>
          <p className="text-sm text-brand-charcoal/60">
            Sign in with email and password to manage your saved addresses.
          </p>
          <Link
            to="/account/logout"
            className="inline-flex items-center justify-center mt-1 px-5 py-2.5 rounded-full text-sm font-semibold text-brand-charcoal bg-brand-mist hover:bg-brand-mist/70 transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Sign out and use email login
          </Link>
        </div>
      ) : addresses.length === 0 ? (
        <EmptyState
          title="No addresses yet ♥"
          description="Let's make checkout faster ♥"
          cta={{ label: 'Add address ♥', to: '/account/addresses/new' }}
        />
      ) : (
        <ul className="space-y-4">
          {sorted.map((address) => (
            <li key={address.id}>
              <AddressCard
                address={address}
                isDefault={address.id === customer.defaultAddressId}
                onDelete={(id) => setDeleteTargetId(id)}
                onSetDefault={handleSetDefault}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Fetcher loading indicator */}
      {isDeleting && (
        <p className="text-xs text-brand-charcoal/40 text-center animate-pulse">
          Updating…
        </p>
      )}

      {/* Confirm delete dialog */}
      <ConfirmDialog
        open={deleteTargetId !== null}
        titleId="confirm-delete-title"
        title="Delete this address?"
        description="This can't be undone. Your saved address will be removed permanently."
        confirmLabel="Yes, delete"
        cancelLabel="Keep it"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  )
}
