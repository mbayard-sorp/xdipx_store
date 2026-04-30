import type { Stage } from './types.server'

// Whitelist of tool names each stage may call. Empty array = no tools (fully templated).
// Tool names match the existing tool registry in app/lib/ai-agent/tools.server.ts.
// NOTE: orderStatusLookup and kbLookup are forward references — they do not exist yet.
export const TOOLS_BY_STAGE: Record<Stage, ReadonlyArray<string>> = {
  GREETING:      [],
  CONSENT_GATE:  [],
  DISCOVERY:     ['searchForIvr', 'lookupReturningCustomer', 'kbLookup'],
  RESEARCH:      ['searchForIvr', 'kbLookup'],
  PRESENTATION:  ['searchForIvr', 'kbLookup'],
  OBJECTION:     ['searchForIvr', 'kbLookup'],
  UPSELL:        ['searchForIvr'],
  CHECKOUT:      [],
  POST_CHECKOUT: [],
  POST_PURCHASE: ['lookupReturningCustomer', 'kbLookup', 'orderStatusLookup'],
  SUPPORT:       ['lookupReturningCustomer', 'orderStatusLookup'],
  RECONNECT:     [],
}
