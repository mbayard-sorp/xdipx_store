/**
 * /admin/socials/comments — Instagram comment support lane, phase 1 (ticket
 * #2027, owner direction 2026-08-08: "yes, we need a support team to reply
 * to comments").
 *
 * Comments arrive here via the hourly /cron/instagram-comments-ingest tick
 * (app/lib/social-publish/instagram-comments.server.ts), one row per
 * comment at status 'inbound'. An admin edits `replyText` inline and either
 * saves the draft (status 'drafted') or sends it immediately, which posts
 * via the Graph API and moves the row to 'replied' with `externalReplyId`
 * recorded. Auto-reply (an AI-drafted `replyText` with no click) is
 * explicitly out of scope here -- every row needs a human click to leave
 * `inbound`/`drafted`.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useState } from 'react'
import { db } from '~/lib/db.server'
import { socialComments } from '../../db/schema'
import { desc, eq, inArray } from 'drizzle-orm'
import { requireAdmin, getAdminUser } from '~/lib/session.server'
import { kvGet } from '~/lib/kv.server'
import { postCommentReply } from '~/lib/social-publish/instagram-comments.server'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { SendIcon, ArchiveIcon, AlertIcon } from '~/components/admin/social/icons'

interface IngestBanner {
  ok: boolean
  postsChecked: number
  fetched: number
  inserted: number
  detail?: string
  checkedAt: string
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const [comments, lastIngest] = await Promise.all([
    db
      .select()
      .from(socialComments)
      .where(inArray(socialComments.status, ['inbound', 'drafted']))
      .orderBy(desc(socialComments.commentedAt), desc(socialComments.fetchedAt))
      .limit(100),
    kvGet<IngestBanner>('social-comments-ingest:last'),
  ])
  return { comments, lastIngest }
}

async function ownerLabel(request: Request): Promise<string> {
  const user = await getAdminUser(request)
  return user?.name || user?.email || 'admin'
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const id = Number(form.get('id'))
  if (!id) return { ok: false, error: 'Missing comment id' }

  const [row] = await db.select().from(socialComments).where(eq(socialComments.id, id)).limit(1)
  if (!row) return { ok: false, error: 'Comment not found' }

  if (intent === 'save-draft') {
    const replyText = String(form.get('replyText') ?? '').trim()
    await db.update(socialComments)
      .set({ replyText, status: replyText ? 'drafted' : 'inbound', updatedAt: new Date() })
      .where(eq(socialComments.id, id))
    return { ok: true }
  }

  if (intent === 'approve-send') {
    const replyText = String(form.get('replyText') ?? row.replyText ?? '').trim()
    if (!replyText) return { ok: false, error: 'Write a reply before sending' }
    const result = await postCommentReply(row.externalCommentId, replyText)
    if (!result.ok) return { ok: false, error: result.detail ?? 'Send failed' }
    const by = await ownerLabel(request)
    await db.update(socialComments)
      .set({
        replyText,
        status: 'replied',
        repliedAt: new Date(),
        repliedBy: by,
        externalReplyId: result.externalReplyId,
        updatedAt: new Date(),
      })
      .where(eq(socialComments.id, id))
    return { ok: true }
  }

  if (intent === 'ignore' || intent === 'escalate') {
    await db.update(socialComments)
      .set({ status: intent === 'ignore' ? 'ignored' : 'escalated', updatedAt: new Date() })
      .where(eq(socialComments.id, id))
    return { ok: true }
  }

  return { ok: false, error: `Unknown intent '${intent}'` }
}

type CommentRow = ReturnType<typeof useLoaderData<typeof loader>>['comments'][number]

function CommentActions({ comment }: { comment: CommentRow }) {
  const [draft, setDraft] = useState(comment.replyText ?? '')
  const save = useFetcher()
  const send = useFetcher()
  const ignore = useFetcher()
  const busy = save.state !== 'idle' || send.state !== 'idle'

  return (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder="Write a reply…"
        rows={2}
        className="w-full rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-ink focus:border-coral focus:outline-none"
      />
      {(send.data as { ok?: boolean; error?: string } | undefined)?.error && (
        <p className="text-xs text-red-600">{(send.data as { error?: string }).error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <save.Form method="post">
          <input type="hidden" name="intent" value="save-draft" />
          <input type="hidden" name="id" value={comment.id} />
          <input type="hidden" name="replyText" value={draft} />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-3 hover:text-ink disabled:opacity-50"
          >
            Save draft
          </button>
        </save.Form>
        <send.Form method="post">
          <input type="hidden" name="intent" value="approve-send" />
          <input type="hidden" name="id" value={comment.id} />
          <input type="hidden" name="replyText" value={draft} />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-coral px-3 py-1.5 text-xs font-medium text-white hover:bg-coral-2 disabled:opacity-50"
          >
            <SendIcon size={14} /> Approve &amp; send
          </button>
        </send.Form>
        <ignore.Form method="post">
          <input type="hidden" name="intent" value="ignore" />
          <input type="hidden" name="id" value={comment.id} />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-3 hover:text-ink disabled:opacity-50"
          >
            <ArchiveIcon size={14} /> Ignore
          </button>
        </ignore.Form>
      </div>
    </div>
  )
}

export default function SocialCommentsQueue() {
  const { comments, lastIngest } = useLoaderData<typeof loader>()

  return (
    <div className="space-y-4">
      {lastIngest && !lastIngest.ok && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertIcon size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Comment ingest is degraded</p>
            <p className="text-xs">{lastIngest.detail}</p>
          </div>
        </div>
      )}

      {comments.length === 0 ? (
        <p className="text-sm text-ink-3">No inbound comments right now.</p>
      ) : (
        <ResponsiveTable>
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-medium text-ink-3">
                <th className="py-2 pr-3">From</th>
                <th className="py-2 pr-3">Comment</th>
                <th className="py-2 pr-3">Reply</th>
              </tr>
            </thead>
            <tbody>
              {comments.map(comment => (
                <tr key={comment.id} className="border-b border-line align-top">
                  <td className="py-3 pr-3 whitespace-nowrap text-ink-3">
                    @{comment.username ?? 'unknown'}
                  </td>
                  <td className="py-3 pr-3 max-w-[320px] text-ink">{comment.text}</td>
                  <td className="py-3 pr-3 min-w-[280px]">
                    <CommentActions comment={comment} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      )}
    </div>
  )
}
