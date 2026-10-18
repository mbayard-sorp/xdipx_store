/**
 * Client entry. Same as React Router's default, plus BotID initialized
 * BEFORE hydration.
 *
 * Why here and not a component: BotID's React `<BotIdClient>` renders its
 * init as an inline <script> through dangerouslySetInnerHTML. That works when
 * the tag is server-rendered into <head> and parsed by the browser, but this
 * app mounted it after hydration (to dodge an SSR hydration mismatch), and a
 * <script> inserted through innerHTML never executes. So BotID never
 * patched fetch, no protected POST ever carried the challenge header, and
 * checkBotId() on production answered 403 to every real visitor on
 * /api/lead, /api/waitlist and /api/reviews. Found by the 2026-10-18
 * lead-funnel audit: both the auditor's browser and the owner's logged
 * "Possible misconfiguration of Vercel BotId" on the server.
 *
 * initBotId() from botid/client/core runs as plain code at module evaluation,
 * before React Router's single fetch makes any request, and touches nothing
 * React hydrates.
 */
import { initBotId } from 'botid/client/core'
import { startTransition, StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'
import { BOTID_PROTECTED_ROUTES } from '~/lib/botid-routes'

initBotId({ protect: [...BOTID_PROTECTED_ROUTES] })

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  )
})
