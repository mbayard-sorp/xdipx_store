/**
 * /admin/reviews/invites — Invite management and stats.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { requireAdmin }  from '~/lib/session.server'
import {
  getInviteStats,
  getPaginatedInvites,
  createInvite,
} from '~/lib/reviews.server'
import { InviteFunnel } from '~/components/reviews/InviteFunnel'

export const meta: MetaFunction = () => [{ title: 'Review Invites — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url  = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') ?? '1', 10)

  const [stats, { invites, total }] = await Promise.all([
    getInviteStats(),
    getPaginatedInvites(page, 20),
  ])

  return { stats, invites, total, page }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form    = await request.formData()
  const intent  = form.get('intent') as string

  if (intent === 'send-invite') {
    const orderId    = form.get('shopifyOrderId')  as string
    const productId  = form.get('shopifyProductId') as string
    const email      = form.get('reviewerEmail')   as string
    const name       = form.get('reviewerName')    as string

    if (!orderId || !productId || !email || !name) {
      return Response.json({ error: 'All fields required' }, { status: 400 })
    }

    await createInvite({
      shopifyOrderId:   orderId,
      shopifyProductId: productId,
      reviewerEmail:    email,
      reviewerName:     name,
    })

    // TODO: Send invite email via Klaviyo trackEvent('Review Invite Sent', ...)
  }

  return Response.json({ ok: true })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

const STATUS_BADGE: Record<string, string> = {
  sent:      'bg-blue-50 text-blue-700',
  opened:    'bg-amber-50 text-amber-700',
  clicked:   'bg-purple-50 text-purple-700',
  completed: 'bg-green-50 text-green-700',
  expired:   'bg-gray-100 text-gray-500',
}

export default function AdminReviewInvites() {
  const { stats, invites, total, page } = useLoaderData<typeof loader>()
  const perPage    = 20
  const totalPages = Math.ceil(total / perPage)

  return (
    <div className="space-y-6">
      <h1
        className="text-2xl font-bold text-brand-charcoal"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Review Invites
      </h1>

      {/* Funnel */}
      <InviteFunnel
        sent={stats.sent}
        opened={stats.opened}
        clicked={stats.clicked}
        completed={stats.completed}
      />

      {/* Manual invite form */}
      <div className="bg-white rounded-2xl border border-brand-mist p-5">
        <p
          className="font-semibold text-brand-charcoal mb-4 text-sm"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Send Manual Invite
        </p>
        <form method="post" className="grid sm:grid-cols-2 gap-3">
          <input type="hidden" name="intent" value="send-invite" />
          {[
            { name: 'shopifyOrderId',   label: 'Order ID',    placeholder: 'gid://shopify/Order/...' },
            { name: 'shopifyProductId', label: 'Product ID',  placeholder: 'gid://shopify/Product/...' },
            { name: 'reviewerEmail',    label: 'Email',        placeholder: 'customer@email.com' },
            { name: 'reviewerName',     label: 'Name',         placeholder: 'Jane D.' },
          ].map(f => (
            <div key={f.name}>
              <label className="block text-xs font-medium text-brand-charcoal/60 mb-1">{f.label}</label>
              <input
                name={f.name}
                type="text"
                placeholder={f.placeholder}
                required
                className="w-full border border-brand-mist rounded-xl px-3 py-2 text-sm text-brand-charcoal focus:outline-none focus:border-brand-purple transition-colors"
              />
            </div>
          ))}
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="bg-brand-gradient text-white font-semibold text-sm px-6 py-2.5 rounded-full hover:opacity-90 transition-opacity"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Send Invite ♥
            </button>
          </div>
        </form>
      </div>

      {/* Invite table */}
      <div className="bg-white rounded-2xl border border-brand-mist overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-mist">
              <th className="px-4 py-3 text-left text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider">Recipient</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider">Product</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wider">Sent</th>
            </tr>
          </thead>
          <tbody>
            {invites.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-brand-charcoal/40">
                  No invites sent yet.
                </td>
              </tr>
            )}
            {invites.map(invite => (
              <tr key={invite.id} className="border-b border-brand-mist last:border-0 hover:bg-brand-mist/40 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-xs text-brand-charcoal">{invite.reviewerName}</p>
                  <p className="text-xs text-brand-charcoal/40">{invite.reviewerEmail}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-mono text-xs text-brand-charcoal/50">{invite.shopifyProductId.slice(-8)}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={[
                    'text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize',
                    STATUS_BADGE[invite.status] ?? 'bg-brand-mist text-brand-charcoal',
                  ].join(' ')}>
                    {invite.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-brand-charcoal/50 whitespace-nowrap">
                  {formatDate(invite.sentAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-brand-mist flex items-center justify-center gap-3">
            {page > 1 && (
              <a href={`/admin/reviews/invites?page=${page - 1}`} className="text-sm text-brand-charcoal/60 hover:text-brand-charcoal">← Prev</a>
            )}
            <span className="text-sm text-brand-charcoal/50">{page} / {totalPages}</span>
            {page < totalPages && (
              <a href={`/admin/reviews/invites?page=${page + 1}`} className="text-sm text-brand-charcoal/60 hover:text-brand-charcoal">Next →</a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
