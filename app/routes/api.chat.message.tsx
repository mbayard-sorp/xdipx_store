import type { ActionFunctionArgs } from 'react-router'
import { parse as parseCookie } from 'cookie'
import { eq, asc } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { chatSessions, chatMessages } from '../../db/schema'
import { checkRateLimit, rateLimited } from '~/lib/rate-limit.server'
import { kvGet, kvSet } from '~/lib/kv.server'
import { loadChatSettings } from '~/lib/emma/settings.server'
import { buildChatSystemPrompt } from '~/lib/emma/prompts.server'
import { ChatSession, type Turn } from '~/lib/emma/session.server'
import { streamChatReply } from '~/lib/emma/stream.server'

const SESSION_COOKIE = '__xdipx_chat'

export async function loader() {
  return Response.json(null)
}

export async function action({ request }: ActionFunctionArgs) {
  const cookies = parseCookie(request.headers.get('Cookie') ?? '')
  const sessionId = cookies[SESSION_COOKIE]
  if (!sessionId) return new Response('No chat session', { status: 401 })

  const rl = await checkRateLimit(request, `chat-msg:${sessionId}`, 6, 10)
  if (!rl.ok) return rateLimited()

  let message: string | null = null
  try {
    const body = await request.json() as { message?: string }
    message = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : null
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  if (!message) return new Response('Empty message', { status: 400 })

  const row = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1)
  const row0 = row[0]
  if (!row0 || row0.status === 'closed') return new Response('Session closed', { status: 410 })

  const settings = await loadChatSettings()

  const systemPrompt = buildChatSystemPrompt(settings.brandVoice, [], settings.goodbye)

  const session = new ChatSession({
    sessionId,
    email: row0.email,
    phone: row0.phone,
    systemPrompt,
    settings,
  })

  // Rehydrate history from KV, or fall back to DB-rebuilt messages
  const kvKey = `chat:session:${sessionId}`
  const stored = await kvGet<{ history: Turn[]; summary: string; tokensUsed: number; createdDraftOrderThisConversation: boolean; wrapUpMode: boolean; toolCallCount: Record<string, number> }>(kvKey)
  if (stored) {
    session.history = stored.history
    session.summary = stored.summary
    session.tokensUsed = stored.tokensUsed
    session.createdDraftOrderThisConversation = stored.createdDraftOrderThisConversation
    session.wrapUpMode = stored.wrapUpMode
    session.toolCallCount = stored.toolCallCount
  } else {
    const msgs = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdAt))
    for (const m of msgs) {
      if (m.role === 'user' || m.role === 'assistant') {
        session.history.push({ role: m.role, content: m.content as Turn['content'] })
      }
    }
    session.tokensUsed = row0.tokensUsed ?? 0
    session.toolCallCount = (row0.toolCallCount as Record<string, number>) ?? {}
    session.summary = row0.summary ?? ''
  }

  session.addTurn('user', message)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      // Persist the user turn immediately
      db.insert(chatMessages)
        .values({ sessionId, role: 'user', content: message as unknown as object })
        .catch((err) => console.warn('[chat.message] persist user failed', err))

      await streamChatReply(session, {
        onToken: (token) => send('token', { text: token }),
        onToolEvent: (event) => send('tool', event),
        onDone: async () => {
          send('done', { tokensUsed: session.tokensUsed, wrapUpMode: session.wrapUpMode })
          controller.close()
          // Persist session state
          try {
            await kvSet(kvKey, {
              history: session.history,
              summary: session.summary,
              tokensUsed: session.tokensUsed,
              createdDraftOrderThisConversation: session.createdDraftOrderThisConversation,
              wrapUpMode: session.wrapUpMode,
              toolCallCount: session.toolCallCount,
            }, 60 * 60 * 2)

            // Persist new assistant turns to DB (everything after the initial user msg)
            const newTurns = session.history.slice(-6) // rough: tail window
            for (const t of newTurns) {
              if (t.role !== 'assistant') continue
              await db.insert(chatMessages).values({
                sessionId,
                role: 'assistant',
                content: t.content as unknown as object,
              })
            }

            await db
              .update(chatSessions)
              .set({
                tokensUsed: session.tokensUsed,
                toolCallCount: session.toolCallCount,
                summary: session.summary,
                lastActivityAt: new Date(),
              })
              .where(eq(chatSessions.id, sessionId))
          } catch (err) {
            console.warn('[chat.message] post-stream persist failed', err)
          }
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : String(err)
          send('error', { message: msg })
          controller.close()
        },
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
