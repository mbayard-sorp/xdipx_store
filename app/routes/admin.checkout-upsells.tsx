import { requireAdmin } from '~/lib/session.server'
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { getPinnedAccessoryIds, setPinnedAccessoryIds } from '~/lib/kv.server'
import { getAccessoryProductsAdmin } from '~/lib/shopify.server'
import { ProductPicker, productToPickerProduct } from '~/components/admin/ProductPicker'

export const meta: MetaFunction = () => [{ title: 'Checkout Upsells — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const pinnedIds = await getPinnedAccessoryIds()
  const pinnedAccessories = pinnedIds.length
    ? await getAccessoryProductsAdmin(pinnedIds)
    : []

  return { pinnedAccessories, pinnedIds }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = form.get('intent')

  if (intent === 'save-pinned-accessories') {
    const ids = JSON.parse(form.get('ids') as string) as string[]
    await setPinnedAccessoryIds(ids)
    return { ok: true }
  }

  return null
}

export default function CheckoutUpsellsPage() {
  const { pinnedAccessories } = useLoaderData<typeof loader>()
  const fetcher = useFetcher<{ ok: boolean }>()

  const handleSave = (ids: string[]) => {
    fetcher.submit(
      { intent: 'save-pinned-accessories', ids: JSON.stringify(ids) },
      { method: 'post' },
    )
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Checkout Upsells
        </h1>
        <p className="text-sm text-ink/60 mt-1">
          Products shown as upsells in the cart drawer. Up to 4 displayed.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <ProductPicker
          initial={pinnedAccessories.map(productToPickerProduct)}
          onSave={handleSave}
          saving={fetcher.state === 'submitting'}
        />
      </div>

      {fetcher.state === 'idle' && fetcher.data?.ok && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
          Upsells saved. Changes are live in the cart drawer.
        </div>
      )}
    </div>
  )
}
