/**
 * GET /api/emma-discovery-chat/stream/:threadId
 *
 * SSE stream for a discovery-chat thread. Validates the session cookie
 * matches the thread's session_id before streaming. Same event format
 * as /api/admin/emma-chat/stream/:threadId (token, tool_call, tool_result,
 * done, error) so client EventSource patterns are reusable.
 */
import type { LoaderFunctionArgs } from 'react-router'
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { emmaChatThreads } from '../../db/schema'
import { getDiscoveryVocab } from '~/lib/discovery.server'
import { streamEmmaDiscoveryReply } from '~/lib/emma-discovery-chat.server'

const COOKIE_NAME = 'xdipx_emma_sid'

function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('Cookie') ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key?.trim() === COOKIE_NAME) {
      const val = rest.join('=').trim()
      return val || null
    }
  }
  return null
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const threadId = Number(params.threadId)
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return new Response('bad threadId', { status: 400 })
  }

  // Validate session cookie against thread ownership.
  const sessionId = readSessionCookie(request)
  if (!sessionId) {
    return new Response('missing session cookie', { status: 401 })
  }

  const [thread] = await db
    .select({ sessionId: emmaChatThreads.sessionId, archived: emmaChatThreads.archived })
    .from(emmaChatThreads)
    .where(eq(emmaChatThreads.id, threadId))
    .limit(1)

  if (!thread) {
    return new Response('thread not found', { status: 404 })
  }
  if (thread.sessionId !== sessionId) {
    return new Response('session mismatch', { status: 403 })
  }
  if (thread.archived) {
    return new Response('thread is archived', { status: 410 })
  }

  // Load live vocab for chip validation inside the stream.
  const vocab = await getDiscoveryVocab()

  const stream = streamEmmaDiscoveryReply({
    sessionId,
    threadId,
    signal: request.signal,
    vocab,
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
