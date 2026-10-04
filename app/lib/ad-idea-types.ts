/**
 * Client-safe shapes for the Ad Studio Ideas tab. No server imports, so
 * components can import them without touching a .server.ts module.
 */

export type FeedbackVerdict = 'up' | 'down'

export interface FeedbackView {
  verdict: FeedbackVerdict
  reasons: string[]
  note: string | null
  ratedBy: string
  ratedAt: string
}

export interface IdeaListItem {
  id: number
  runId: number | null
  conceptSlug: string
  lane: string
  registerTier: string
  title: string
  oneLiner: string | null
  products: Array<{ handle: string; title?: string }>
  headlines: string[]
  body: string[]
  audience: Record<string, unknown> | null
  destinationUrl: string | null
  breakEven: Record<string, unknown> | null
  policyCheck: string
  status: string
  createdAt: string
  creativeCount: number
  feedback: FeedbackView | null
}
