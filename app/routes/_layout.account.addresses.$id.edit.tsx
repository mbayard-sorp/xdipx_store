import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { redirect, useActionData, useLoaderData } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { getCountries } from '~/lib/shopify.server'
import type { CustomerAddressInput } from '~/lib/shopify.server'
import { AddressForm } from '~/components/account/AddressForm'

export const meta: MetaFunction = () => [{ title: 'Edit address — xdipx' }]

// ── Loader ───────────────────────────────────────────────────────────────────
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)

  // Customer Account API (Shop OAuth) can't manage addresses — redirect to list
  if (tokenType === 'account') {
    throw redirect('/account/addresses')
  }

  // noUncheckedIndexedAccess: params['id'] may be undefined
  const rawId = params['id']
  if (!rawId) throw new Response('Address not found', { status: 404 })

  // Shopify GIDs contain slashes, so the id is URL-encoded in the route param
  const decodedId = decodeURIComponent(rawId)

  const api = customerAPI({ token, tokenType })
  const addresses = await api.getAddresses()
  // Shopify address GIDs embed a `customer_access_token` query string that
  // changes between requests. Match on the GID base (before the `?`) so the
  // token mismatch doesn't break the lookup.
  const gidBase = (s: string) => s.split('?')[0]
  const targetBase = gidBase(decodedId)
  const address = addresses.find((a) => gidBase(a.id) === targetBase)

  if (!address) {
    console.error('[addresses/edit] address not found', {
      tokenType,
      rawId,
      decodedId,
      targetBase,
      addressIds: addresses.map((a) => a.id),
    })
    throw new Response('Address not found', { status: 404 })
  }

  const countries = await getCountries()
  return { address, countries }
}

// ── Action ───────────────────────────────────────────────────────────────────
export async function action({ request, params }: ActionFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)

  const rawId = params['id']
  if (!rawId) throw new Response('Address not found', { status: 404 })
  // Strip embedded customer_access_token query string; Shopify accepts the
  // bare MailingAddress GID on mutations.
  const decodedId = decodeURIComponent(rawId).split('?')[0] ?? ''

  const api = customerAPI({ token, tokenType })
  const form = await request.formData()

  const firstName  = (form.get('firstName')  as string | null)?.trim() || undefined
  const lastName   = (form.get('lastName')   as string | null)?.trim() || undefined
  const company    = (form.get('company')    as string | null)?.trim() || undefined
  const address1   = (form.get('address1')   as string | null)?.trim() || undefined
  const address2   = (form.get('address2')   as string | null)?.trim() || undefined
  const city       = (form.get('city')       as string | null)?.trim() || undefined
  const country    = (form.get('country')    as string | null)?.trim() || undefined
  const province   = (form.get('province')   as string | null)?.trim() || undefined
  const zip        = (form.get('zip')        as string | null)?.trim() || undefined
  const phone      = (form.get('phone')      as string | null)?.trim() || undefined
  const setDefault = form.get('setDefault') as string | null

  // exactOptionalPropertyTypes: only include keys that have actual values
  const input: CustomerAddressInput = {
    ...(firstName ? { firstName } : {}),
    ...(lastName  ? { lastName  } : {}),
    ...(company   ? { company   } : {}),
    ...(address1  ? { address1  } : {}),
    ...(address2  ? { address2  } : {}),
    ...(city      ? { city      } : {}),
    ...(country   ? { country   } : {}),
    ...(province  ? { province  } : {}),
    ...(zip       ? { zip       } : {}),
    ...(phone     ? { phone     } : {}),
  }

  const result = await api.updateAddress(decodedId, input)

  if ('error' in result) {
    return { error: result.error }
  }

  // Best-effort set-default
  if (setDefault === 'on') {
    try {
      const defResult = await api.setDefaultAddress(decodedId)
      if ('error' in defResult) {
        console.error('[addresses/edit] setDefaultAddress failed:', defResult.error)
      }
    } catch (err) {
      console.error('[addresses/edit] setDefaultAddress threw:', err)
    }
  }

  throw redirect('/account/addresses')
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function EditAddressPage() {
  const { address, countries } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()

  return (
    <div className="space-y-6 max-w-lg">
      {/* Desktop heading */}
      <section className="hidden lg:block">
        <h1
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Edit address <span className="text-sage">♥</span>
        </h1>
      </section>

      <AddressForm
        mode="edit"
        initial={address}
        countries={countries}
        actionData={actionData}
      />
    </div>
  )
}
