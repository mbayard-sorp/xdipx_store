import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { streamEmmaReply } from '~/lib/emma-chat.server'

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const threadId = Number(params.threadId)
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return new Response('bad threadId', { status: 400 })
  }
  const stream = streamEmmaReply({ threadId, signal: request.signal })
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
