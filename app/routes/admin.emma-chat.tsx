import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Link, useFetcher } from 'react-router'
import { redirect } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import {
  listThreads,
  createThread,
  archiveThread,
  type EmmaChatThread,
} from '~/lib/emma-chat.server'
import { NewThreadForm } from '~/components/admin/EmmaChat/NewThreadForm'

export const meta: MetaFunction = () => [{ title: 'Emma Chat — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const threads = await listThreads({ limit: 50 })
  return { threads }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = form.get('intent') as string

  if (intent === 'create') {
    const firstUserMessage = (form.get('firstUserMessage') as string | null)?.trim() ?? ''
    if (firstUserMessage.length < 3) {
      return { error: 'Message must be at least 3 characters.' }
    }
    const redditPostUrl = (form.get('redditPostUrl') as string | null)?.trim() || null
    const redditPostExcerpt = (form.get('redditPostExcerpt') as string | null)?.trim() || null
    const { threadId } = await createThread({ firstUserMessage, redditPostUrl, redditPostExcerpt })
    return redirect(`/admin/emma-chat/${threadId}`)
  }

  if (intent === 'archive') {
    const threadId = Number(form.get('threadId'))
    if (Number.isFinite(threadId) && threadId > 0) {
      await archiveThread(threadId)
    }
    return { ok: true }
  }

  return { error: 'Unknown intent' }
}

function timeAgo(date: Date): string {
  const now = Date.now()
  const diffMs = now - new Date(date).getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

function ThreadRow({ thread }: { thread: EmmaChatThread }) {
  const fetcher = useFetcher()
  const isArchiving = fetcher.state !== 'idle'
  // Optimistic hide
  if (isArchiving) return null

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-paper rounded-xl border border-line hover:border-coral/30 transition-all group">
      <Link
        to={`/admin/emma-chat/${thread.id}`}
        className="flex-1 min-w-0"
      >
        <p
          className="text-sm font-semibold text-ink truncate group-hover:text-coral transition-colors"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {thread.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted" style={{ fontFamily: 'var(--font-body)' }}>
            {timeAgo(thread.updatedAt)}
          </span>
          {thread.redditPostUrl && (
            <>
              <span className="text-muted/40">·</span>
              <span className="text-xs text-coral/70">has post URL</span>
            </>
          )}
        </div>
      </Link>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="archive" />
        <input type="hidden" name="threadId" value={thread.id} />
        <button
          type="submit"
          className="text-muted/40 hover:text-muted text-xs px-2 py-1 rounded-lg hover:bg-cream transition-all opacity-0 group-hover:opacity-100"
          style={{ fontFamily: 'var(--font-display)' }}
          title="Archive thread"
        >
          Archive
        </button>
      </fetcher.Form>
    </div>
  )
}

export default function EmmaChatList() {
  const { threads } = useLoaderData<typeof loader>()

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Emma Chat
        </h1>
        <p className="text-sm text-muted mt-1" style={{ fontFamily: 'var(--font-body)' }}>
          Internal SME for drafting Reddit replies. Not customer-facing.
        </p>
      </div>

      <NewThreadForm />

      {threads.length === 0 ? (
        <div className="text-center py-16 bg-paper rounded-2xl border border-line">
          <div className="text-3xl mb-3">💬</div>
          <p className="text-sm font-semibold text-ink mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            No threads yet
          </p>
          <p className="text-sm text-muted" style={{ fontFamily: 'var(--font-body)' }}>
            Start a thread by pasting a Reddit post and asking Emma for a draft reply.
          </p>
          <p className="text-xs text-muted/60 mt-3 italic" style={{ fontFamily: 'var(--font-body)' }}>
            Example: "I'm new to wands. Looking for something quiet under $150. Any recs?"
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map(thread => (
            <ThreadRow key={thread.id} thread={thread} />
          ))}
        </div>
      )}
    </div>
  )
}
