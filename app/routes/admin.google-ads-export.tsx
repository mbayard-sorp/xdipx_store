/**
 * /admin/google-ads-export — export unexported Google click conversions
 * (tickets #3422/#3535) as a Google Ads offline-conversion-import CSV, then
 * mark the exported batch so it is never re-sent.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Form } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import {
  getUnexportedGoogleClickConversions,
  googleClickConversionToCSVRow,
  markGoogleClickConversionsExported,
  GOOGLE_ADS_CSV_HEADER,
} from '~/lib/google-ads-export.server'

export const meta: MetaFunction = () => [{ title: 'Google Ads Export — xdipx Admin' }]

const DEFAULT_CONVERSION_NAME = 'xdipx Purchase'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const pending = await getUnexportedGoogleClickConversions()
  return { pendingCount: pending.length }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const conversionName = (form.get('conversionName') as string | null)?.trim() || DEFAULT_CONVERSION_NAME

  const rows = await getUnexportedGoogleClickConversions()
  const lines = [GOOGLE_ADS_CSV_HEADER, ...rows.map(r => googleClickConversionToCSVRow(r, conversionName))]
  await markGoogleClickConversionsExported(rows.map(r => r.id))

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="google-ads-conversions-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  })
}

export default function AdminGoogleAdsExport() {
  const { pendingCount } = useLoaderData<typeof loader>()

  return (
    <div className="max-w-lg">
      <h1
        className="text-2xl font-bold text-ink mb-8"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Google Ads Export
      </h1>

      <div className="bg-white rounded-2xl border border-line p-6 space-y-6">
        <div className="bg-paper-2 rounded-xl p-3">
          <p className="text-xs text-ink-3">Pending conversions</p>
          <p className="text-2xl font-black text-ink" style={{ fontFamily: 'var(--font-display)' }}>
            {pendingCount}
          </p>
        </div>

        <Form method="post" className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>
              Conversion action name
            </label>
            <input
              type="text"
              name="conversionName"
              defaultValue={DEFAULT_CONVERSION_NAME}
              className="border border-line rounded-xl px-3 py-2 text-sm text-ink w-full focus:outline-none focus:border-sage"
            />
            <p className="text-xs text-ink-3 mt-1">Must match a conversion action already set up in Google Ads.</p>
          </div>

          <button
            type="submit"
            disabled={pendingCount === 0}
            className="w-full bg-coral text-white font-semibold py-3 rounded-full hover:opacity-90 transition-opacity disabled:opacity-40"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Download Export ♥
          </button>
        </Form>
      </div>
    </div>
  )
}
