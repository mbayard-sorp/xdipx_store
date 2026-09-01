/**
 * /admin/socials/compose/:id: the Composer on an existing row. Owner edits
 * are allowed on pending_review, needs_changes, approved AND failed rows
 * (ticket #5417); every save runs the revert-to-draft reset first (ADR-013
 * decision 4), so any of those goes back to pending with its stamp burned.
 * `locked` mirrors `revertSocialPostToDraft` exactly (social-publish-approve.
 * server.ts): it refuses ONLY `posted`, `deleted`, and a gate-BLOCK
 * (`reviewStatus === 'rejected'`) row, and a failed publish is none of those,
 * so a failed Instagram/X post can have its image swapped in the library
 * picker and be retried. Posted rows open read-only with the reason; history
 * is not edited.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { useLoaderData, Link, Form } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { Composer } from '~/components/admin/social/Composer'
import { PlatformMock, mediaRefsOf } from '~/components/admin/social/PostPreviewCard'
import { StatusPill, studioStatusOf } from '~/components/admin/social/StatusPill'
import {
  composerRoster, handleComposerIntent, initialFromPost, loadComposerPost, resolvePickedProduct, slidesFromAssetsParam,
} from '~/lib/social-composer.server'

function parseId(raw: string | undefined): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const id = parseId(params['id'])
  if (!id) throw new Response('Not found', { status: 404 })
  const post = await loadComposerPost(id)
  if (!post) throw new Response('Not found', { status: 404 })
  const url = new URL(request.url)
  const [roster, product, extraSlides] = await Promise.all([
    composerRoster(),
    resolvePickedProduct(post.row.shopifyProductId),
    slidesFromAssetsParam(url),
  ])
  const locked = post.row.status === 'posted' || post.row.status === 'deleted' || post.row.reviewStatus === 'rejected'
  return {
    id,
    locked,
    lockReason: post.row.status === 'posted'
      ? 'This post is published. History is not edited; draft a new one.'
      : post.row.reviewStatus === 'rejected'
        ? 'This post carries a gate BLOCK, which has no override. Start a fresh draft.'
        : post.row.status === 'deleted'
          ? 'This post was deleted on the platform.'
          : null,
    row: post.row,
    initial: initialFromPost(post, product, extraSlides),
    roster,
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdmin(request)
  const id = parseId(params['id'])
  if (!id) return { ok: false, error: 'Bad post id' }
  const form = await request.formData()
  const handled = await handleComposerIntent(form, id)
  return handled ?? { ok: false, error: 'Unknown intent' }
}

export default function ComposeExisting() {
  const { id, locked, lockReason, row, initial, roster } = useLoaderData<typeof loader>()
  if (locked) {
    const media = mediaRefsOf(row as Parameters<typeof mediaRefsOf>[0])
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl text-ink">Post #{id}</h2>
          <StatusPill status={studioStatusOf(row)} />
          <span className="flex-1" />
          <Link to="/admin/socials/queue?view=history" className="text-sm text-ink-3 hover:text-ink min-h-11 inline-flex items-center">Back to history</Link>
        </div>
        <p className="rounded-xl border border-line bg-paper-2 px-3 py-2 text-sm text-ink-3">{lockReason}</p>
        <div className="rounded-2xl border border-line bg-paper-2 p-3 inline-block">
          <PlatformMock platform={row.platform} media={media} caption={row.editedText?.trim() || row.tweetText} />
        </div>
        {row.status === 'deleted' && (
          row.removalSource === 'owner' ? (
            <p className="text-sm text-ink-3">Marked as removed by you. It never counts toward a takedown pattern.</p>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="mark-removal-owner" />
              <button
                type="submit"
                className="inline-flex items-center min-h-11 px-4 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4"
                title="The removal watcher cannot tell a platform takedown from you deleting this yourself. If this was you, say so here."
              >
                I removed this
              </button>
            </Form>
          )
        )}
        <Link to={`/admin/socials/compose/new?platform=${row.platform}`} className="inline-flex items-center min-h-11 px-4 rounded-full bg-coral text-white text-sm font-semibold hover:bg-coral-2">
          Draft a new one
        </Link>
      </div>
    )
  }
  return <Composer key={initial.updatedAt ?? id} postId={id} initial={initial} roster={roster} />
}
