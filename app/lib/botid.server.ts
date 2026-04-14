/**
 * Thin wrapper around Vercel BotID — returns a Response (403) to short-circuit
 * route handlers when a bot is detected. No-op in local dev (checkBotId
 * returns `isBot: false` when BotID isn't deployed).
 */
import { checkBotId } from 'botid/server'

const isDev = process.env['NODE_ENV'] !== 'production'

export async function rejectIfBot(): Promise<Response | null> {
  if (isDev) return null
  const result = await checkBotId()
  if (result.isBot && !result.isVerifiedBot) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
