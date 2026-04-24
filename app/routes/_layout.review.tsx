/**
 * /review — Customer review submission page.
 * Supports ?token=X (invite flow) or ?productId=X (direct link).
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, redirect } from 'react-router'
import { getInviteByToken } from '~/lib/reviews.server'
import { ReviewForm }       from '~/components/reviews/ReviewForm'

export const meta: MetaFunction = () => [
  { title: 'Write a Review | xdipx' },
  { name: 'robots', content: 'noindex' },
]

export async function loader({ request }: LoaderFunctionArgs) {
  const url       = new URL(request.url)
  const token     = url.searchParams.get('token')
  const productId = url.searchParams.get('productId')

  if (token) {
    // Invite flow: look up invite to get product ID and reviewer name
    const invite = await getInviteByToken(token)
    if (!invite) throw redirect('/')

    // Check not expired (7 days)
    const age = Date.now() - new Date(invite.sentAt).getTime()
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    if (age > sevenDays || invite.status === 'expired') {
      throw redirect('/?invite=expired')
    }

    // Try to get product title from Shopify
    // We don't have the handle, only the product ID — just pass what we have
    return {
      productId:          invite.shopifyProductId,
      productTitle:       null,
      reviewerName:       invite.reviewerName,
      isVerifiedPurchase: true,
      inviteToken:        token,
    }
  }

  if (productId) {
    return {
      productId,
      productTitle:       null,
      reviewerName:       '',
      isVerifiedPurchase: false,
      inviteToken:        null,
    }
  }

  throw redirect('/')
}

export default function ReviewPage() {
  const { productId, productTitle, reviewerName, isVerifiedPurchase, inviteToken } =
    useLoaderData<typeof loader>()

  return (
    <div className="min-h-screen bg-cream py-12 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <span
            className="text-3xl font-black text-coral select-none"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            xdipx
          </span>
          <p className="text-sm text-ink/50 mt-1">
            {isVerifiedPurchase ? 'Thanks for your purchase! ♥' : 'Share your experience'}
          </p>
        </div>

        <ReviewForm
          productId={productId ?? undefined}
          inviteToken={inviteToken ?? undefined}
          reviewerName={reviewerName ?? undefined}
          productTitle={productTitle ?? undefined}
          isVerifiedPurchase={isVerifiedPurchase}
        />
      </div>
    </div>
  )
}
