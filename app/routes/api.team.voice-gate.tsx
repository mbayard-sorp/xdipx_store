/**
 * POST /api/team/voice-gate
 *
 *   { op omitted; body: { text, addendum?, platform? } } -> { verdict, reviewer, notes }
 *
 * The voice-gate half of ticket #6916. Runs `emma-empathy-reviewer`'s charter
 * check as a server-side model call instead of a spawned subagent, which the
 * scheduled social routine's execution context does not have (see
 * `app/lib/team-gates.server.ts` header comment for the full context and the
 * runs that confirmed it).
 *
 * `routine-social-daily.md` Step 4a calls this for every draft's caption
 * before `POST /api/team/social-post {op:'draft', voiceGate:{...}}`, whose
 * own `verdict:'PASS'` requirement (ticket #3208) is unchanged: a REVISE or
 * BLOCK here still means the draft is not written.
 *
 * `addendum` is `'social'` (Instagram/TikTok/X, the default) or `'linkedin'`.
 * Any other value falls back to `'social'`.
 *
 * `platform` (ticket #8853) is `'instagram' | 'tiktok' | 'x'`, optional. The
 * 'social' addendum's own text calibrates hashtag count and PDP-link use
 * differently per platform (X runs 0-3 hashtags where Instagram/TikTok run
 * 5-8); without `platform` the model cannot tell which caption it is reading
 * and defaults to the Instagram/TikTok reading. Omit for LinkedIn drafts or
 * when genuinely unknown — omitting reproduces the pre-#8853 prompt exactly.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { runVoiceGateCheck, type VoiceGateAddendum, type VoiceGatePlatform } from '~/lib/team-gates.server'
import { apiError } from '~/lib/api-error.server'

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return new Response('Bad Request: invalid JSON body', { status: 400 })
  }

  const text = typeof body['text'] === 'string' ? body['text'] : ''
  if (!text.trim()) return new Response('Bad Request: text required', { status: 400 })
  const addendum = typeof body['addendum'] === 'string' ? (body['addendum'] as VoiceGateAddendum) : undefined
  const platform = typeof body['platform'] === 'string' ? (body['platform'] as VoiceGatePlatform) : undefined

  try {
    const result = await runVoiceGateCheck({ text, addendum, platform })
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof Response) return err
    return apiError('team-voice-gate', err, 'voice-gate check failed')
  }
}
