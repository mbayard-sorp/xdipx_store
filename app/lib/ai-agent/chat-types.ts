// Shared Emma-chat types safe to import from client components.
// Kept separate from chat.server.ts so the server bundle isn't pulled into the
// client when components type-import these shapes.

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export type ChatPricePhrasing = 'deal' | 'map_floor' | 'msrp_only'

export interface ChatVariantOption {
  variantId: string
  label: string
  price: number
  inStock: boolean
}

export interface ChatProductCard {
  handle: string
  title: string
  tagline: string
  category: string
  price: number
  pctOff: number
  phrasing: ChatPricePhrasing
  inStock: boolean
  variantId: string
  url: string
  imageUrl?: string
  imageAlt?: string
  variantOptions?: ChatVariantOption[]
}

export type QuickReplyMode = 'single' | 'multi'

export interface QuickReplyPayload {
  question: string
  options: string[]
  mode: QuickReplyMode
}

export interface ChatReply {
  reply: string
  products: ChatProductCard[]
  history: ChatTurn[]
  quickReply?: QuickReplyPayload
  /** Signals that Emma added something to the site cart. Client should revalidate the cart loader and open the drawer. */
  cartUpdated?: boolean
  /** Total Anthropic token usage across all hops in this reply. Server-only; not sent to the client. */
  usage?: { inputTokens: number; outputTokens: number }
}
