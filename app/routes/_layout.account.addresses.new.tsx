import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { redirect, useActionData, useLoaderData } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { getCountries } from '~/lib/shopify.server'
import type { CustomerAddressInput } from '~/lib/shopify.server'
import { AddressForm } from '~/components/account/AddressForm'

export const meta: MetaFunction = () => [{ title: 'Add address — xdipx' }, { name: 'robots', content: 'noindex, nofollow' }]

// ── Loader ───────────────────────────────────────────────────────────────────
export async function loader({ request }: LoaderFunctionArgs) {
  const { tokenType } = await requireCustomer(request)

  // Customer Account API (Shop OAuth) sessions can't manage addresses.
  // Redirect to the list page which shows the explanatory notice.
  if (tokenType === 'account') {
    throw redirect('/account/addresses')
  }

  const countries = await getCountries()
  return { countries }
}

// ── Action ───────────────────────────────────────────────────────────────────
export async function action({ request }: ActionFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
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

  // exactOptionalPropertyTypes: only include keys with actual values
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

  const result = await api.createAddress(input)

  if ('error' in result) {
    return { error: result.error }
  }

  // Best-effort set-default — don't fail the save if this step errors
  if (setDefault === 'on') {
    try {
      const defResult = await api.setDefaultAddress(result.address.id)
      if ('error' in defResult) {
        console.error('[addresses/new] setDefaultAddress failed:', defResult.error)
      }
    } catch (err) {
      console.error('[addresses/new] setDefaultAddress threw:', err)
    }
  }

  throw redirect('/account/addresses')
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function NewAddressPage() {
  const { countries } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()

  return (
    <div className="space-y-6 max-w-lg">
      {/* Desktop heading */}
      <section className="hidden lg:block">
        <h1
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Add address <span className="text-sage">♥</span>
        </h1>
      </section>

      <AddressForm
        mode="new"
        countries={countries}
        actionData={actionData}
      />
    </div>
  )
}
