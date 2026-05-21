import type { LoaderFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { streamAgentReply } from '~/lib/emma-chat.server'
import { PM_SYSTEM_PROMPT } from '~/lib/pm-chat-prompt.server'
import { PM_CHAT_TOOLS, dispatchPmTool } from '~/lib/pm-chat-tools.server'

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const threadId = Number(params.threadId)
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return new Response('bad threadId', { status: 400 })
  }
  const stream = streamAgentReply({
    threadId,
    signal:       request.signal,
    systemPrompt: PM_SYSTEM_PROMPT,
    tools:        PM_CHAT_TOOLS,
    dispatchTool: dispatchPmTool,
  })
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type':    'text/event-stream; charset=utf-8',
      'cache-control':   'no-cache, no-transform',
      'connection':      'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
