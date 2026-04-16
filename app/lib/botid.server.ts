/**
 * Thin wrapper around Vercel BotID — returns a Response (403) to short-circuit
 * route handlers when a bot is detected. No-op in local dev (checkBotId
 * returns `isBot: false` when BotID isn't deployed).
 */
import { checkBotId } from 'botid/server'

const isDev = process.env['NODE_ENV'] !== 'production'
// Vercel sets VERCEL_ENV to 'production' | 'preview' | 'development'.
// Only gate on the real prod deploy — preview/staging doesn't have BotID
// client-side protection wired up and will false-positive every request.
const isProdDeploy = process.env['VERCEL_ENV'] === 'production'

export async function rejectIfBot(): Promise<Response | null> {
  if (isDev || !isProdDeploy) return null
  const result = await checkBotId()
  if (result.isBot && !result.isVerifiedBot) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
