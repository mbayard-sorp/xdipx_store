export type Stage =
  | 'GREETING'
  | 'CONSENT_GATE'
  | 'DISCOVERY'
  | 'RESEARCH'
  | 'PRESENTATION'
  | 'OBJECTION'
  | 'UPSELL'
  | 'CHECKOUT'
  | 'POST_CHECKOUT'
  | 'POST_PURCHASE'
  | 'SUPPORT'
  | 'RECONNECT'

export type Intent =
  | 'STOP_HELP_START'
  | 'AGE_CONFIRM'
  | 'COMMIT_PICK'
  | 'UPSELL_ACCEPT'
  | 'UPSELL_DECLINE'
  | 'NAME_ITEM'
  | 'SUPPORT'
  | 'OBJECTION'
  | 'RESEARCH'
  | 'OFF_TOPIC'

export interface IntentResult {
  intent: Intent
  confidence: number  // 0..1
  source: 'regex' | 'haiku' | 'fallback'
  slots?: Record<string, string> | undefined
}

export interface ProductRef {
  handle: string
  title: string
  price?: string | undefined
  imageUrl?: string | undefined
  pdpUrl: string
}

export interface CustomerContext {
  gid?: string | undefined
  firstName?: string | undefined
  defaultZip?: string | undefined
  lastOrderItems?: ProductRef[] | undefined
}

export interface ProductContext extends ProductRef {
  description?: string | undefined
  manufacturerSpecs?: Record<string, string> | undefined
  reviews?: { rating: number; count: number; excerpts?: string[] | undefined } | undefined
}

export interface CartContext {
  cartId?: string | undefined
  items: Array<{ handle: string; quantity: number }>
  subtotal?: string | undefined
}

export interface ShippingContext {
  zip: string
  etaDaysMin: number
  etaDaysMax: number
}

export interface KbContext {
  shippingPolicy?: string | undefined
  returnsPolicy?: string | undefined
  compatibility?: Record<string, string> | undefined
}

export interface EmmaContext {
  conversation: {
    phone: string
    conversationId: string
    stage: Stage
    currentPitchHandle: string | null
    currentUpsellHandle: string | null
    lastQuoteUrl: string | null
  }
  customer?: CustomerContext | undefined
  todaysPick?: ProductContext | undefined
  pitchedProduct?: ProductContext | undefined
  upsellProduct?: ProductContext | undefined
  cart?: CartContext | undefined
  shippingEta?: ShippingContext | undefined
  kb?: KbContext | undefined
}

export interface ConversationStateWrites {
  stage?: Stage | undefined
  currentPitchHandle?: string | null | undefined
  currentUpsellHandle?: string | null | undefined
  lastQuoteUrl?: string | null | undefined
  lastQuoteItems?: Array<{ handle: string; quantity: number }> | null | undefined
  lastQuoteCreatedAt?: Date | null | undefined
  customerGid?: string | null | undefined
}

export interface StageResponse {
  stageOut: Stage
  goalAchieved: boolean
  segments: Array<{
    prose: string
    productCard?: ProductRef | undefined
    cta?: { kind: 'checkout' | 'pdp' | 'collection'; url: string } | undefined
    pillOptions?: string[] | undefined
  }>
  stateWrites: ConversationStateWrites
  telemetry: {
    intent: Intent
    intentConfidence: number
    inputTokens?: number | undefined
    outputTokens?: number | undefined
    toolCalls?: Array<{ name: string; input: unknown; ok: boolean; error?: string | undefined }> | undefined
    fabricationCaught?: string | undefined
  }
}
