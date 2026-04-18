/**
 * Twilio ConversationRelay WebSocket message shapes.
 * https://www.twilio.com/docs/voice/twiml/connect/conversationrelay
 *
 * We keep types narrow (only fields we actually consume/produce).
 */

export interface TwilioSetupMessage {
  type: 'setup'
  sessionId: string
  callSid: string
  from: string
  to: string
  direction: 'inbound' | 'outbound'
  accountSid: string
  // plus other metadata fields we ignore
}

export interface TwilioPromptMessage {
  type: 'prompt'
  voicePrompt: string
  lang?: string
  last?: boolean
}

export interface TwilioInterruptMessage {
  type: 'interrupt'
  utteranceUntilInterrupt?: string
  durationUntilInterruptMs?: number
}

export interface TwilioDtmfMessage {
  type: 'dtmf'
  digit: string
}

export interface TwilioErrorMessage {
  type: 'error'
  description?: string
}

export type TwilioInboundMessage =
  | TwilioSetupMessage
  | TwilioPromptMessage
  | TwilioInterruptMessage
  | TwilioDtmfMessage
  | TwilioErrorMessage

export interface OutboundTextMessage {
  type: 'text'
  token: string
  last: boolean
}

export interface OutboundEndMessage {
  type: 'end'
  handoffData?: string
}

export type OutboundMessage = OutboundTextMessage | OutboundEndMessage
