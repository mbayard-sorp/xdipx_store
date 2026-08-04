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
    /** Discovery gate state machine snapshot. Null for legacy rows. */
    discoveryState?: unknown | null
    /** Accumulated discovery slots. Empty object for legacy rows. */
    discoveredSlots?: Record<string, unknown>
    /** Migration 032: rolling summary injected into system prompt. Null until first summarizer run. */
    conversationSummary?: string | null
    /** Migration 032: ordered log of last 10 pitched handles (most-recent last). */
    pitchedHandlesLog?: string[] | null
    /**
     * Web-only: the product handle of the page the customer currently has open.
     * Populated by the web context builder from WebConversationRow.pageHandle.
     * Null on SMS/voice (those channels have no browser page context).
     * Used by conversation-agent to build the page-context line in
     * <known_about_customer> even before any pitch has been set (cold PDP visit).
     */
    pageHandle?: string | null
  }
  customer?: CustomerContext | undefined
  todaysPick?: ProductContext | undefined
  pitchedProduct?: ProductContext | undefined
  upsellProduct?: ProductContext | undefined
  cart?: CartContext | undefined
  shippingEta?: ShippingContext | undefined
  kb?: KbContext | undefined
  /**
   * Channel the current turn is running on. Stage handlers can use this to
   * adapt prose length / TTS-friendliness. Matches the cross-channel.server
   * Channel type ('sms' | 'voice' | 'web'). Defaults to 'sms' for backward
   * compatibility when adapters don't set it.
   */
  channel?: 'sms' | 'voice' | 'web'
}

export interface ConversationStateWrites {
  stage?: Stage | undefined
  currentPitchHandle?: string | null | undefined
  currentUpsellHandle?: string | null | undefined
  lastQuoteUrl?: string | null | undefined
  lastQuoteItems?: Array<{ handle: string; quantity: number }> | null | undefined
  lastQuoteCreatedAt?: Date | null | undefined
  customerGid?: string | null | undefined
  /** Discovery gate state machine snapshot. Typed as unknown to avoid circular
   *  imports — the processor passes it through as raw JSON. */
  discoveryState?: unknown | null | undefined
  /** Accumulated discovery slots. Typed as Record to avoid circular imports. */
  discoveredSlots?: Record<string, unknown> | undefined
  /** Migration 032: Haiku-generated rolling summary. Written fire-and-forget. */
  conversationSummary?: string | null | undefined
  /**
   * Migration 032: ordered log of last 10 pitched handles (most-recent last).
   * Application layer enforces the cap before writing.
   */
  pitchedHandlesLog?: string[] | null | undefined
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
  /** Set when the checkout stage minted a NEW Shopify cart for a web shopper
   *  who had no cart cookie. The web route must persist it via Set-Cookie or
   *  the lines land in a cart the browser can never see again. */
  createdCartId?: string | undefined
  telemetry: {
    intent: Intent
    intentConfidence: number
    inputTokens?: number | undefined
    outputTokens?: number | undefined
    toolCalls?: Array<{ name: string; input: unknown; ok: boolean; error?: string | undefined }> | undefined
    fabricationCaught?: string | undefined
    /** True when this turn was a vulnerability soft-beat (gate not advanced,
     *  no product surfaced). Written to sms_turns.soft_beat column. */
    softBeat?: boolean | undefined
    /**
     * Migration 032: true when the Sonnet loop exhausted MAX_TOOL_HOPS with a
     * pending tool_use stop_reason, causing safeFallback to run. Written to
     * sms_turns.tool_budget_exhausted column for dashboard telemetry.
     */
    toolBudgetExhausted?: boolean | undefined
    /**
     * ADR-003a Fix 3: true when searchProducts returned all_results_previously_pitched
     * (dedup emptied the result set because every candidate was in pitchedHandlesLog).
     * Distinct from tool_budget_exhausted. Written to sms_turns for dashboard telemetry
     * so this failure mode is visible without parsing the tool result reason code.
     */
    searchRepeatedPitch?: boolean | undefined
    /**
     * Migration 036: discovery-gate transition signal for SMS skip-rate analytics.
     * Populated by the discovery stage handler with the gate before/after this
     * turn, whether the user hit the "Just show me" skip sentinel, and which
     * slot (if any) was newly filled. Written to sms_turns.metadata.gateAdvance.
     * See docs/what-matters-final-signoff.md.
     */
    gateAdvance?: {
      from: 'MOOD' | 'WHO' | 'MATTERS' | 'READY' | 'EXPLAIN' | null
      to:   'MOOD' | 'WHO' | 'MATTERS' | 'READY' | 'EXPLAIN'
      skipped: boolean
      slotFilled: 'mood' | 'who' | 'matters' | null
    } | undefined
  }
}
