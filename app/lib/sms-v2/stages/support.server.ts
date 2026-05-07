/**
 * app/lib/sms-v2/stages/support.server.ts
 *
 * Phase 6b — SUPPORT stage handler.
 *
 * Deterministic: no LLM call. Looks up the customer's latest order via
 * orderStatusLookup, renders a templated status reply, stays in SUPPORT.
 *
 * Intent-driven transitions out of SUPPORT happen via the Phase 5.5 shim
 * (stage-dispatch.server.ts) on the next turn.
 *
 * Tools this stage may call:
 *   - lookupReturningCustomer (via orderStatusLookup internal resolution)
 *   - orderStatusLookup
 */

import { resolveTransition } from '../transitions.server'
import { orderStatusLookup, OrderNotFoundError } from '../tools/order-status.server'
import {
  pickSupportTemplate,
  NOT_FOUND_REPLY,
} from '../templates/support-templates'
import type { EmmaContext, IntentResult, StageResponse } from '../types.server'

// ─── Main export ──────────────────────────────────────────────────────────────

export async function executeSupportStage(
  ctx: EmmaContext,
  intent: IntentResult,
  _customerText: string,
): Promise<StageResponse> {
  const toolCalls: StageResponse['telemetry']['toolCalls'] = []
  let prose: string

  try {
    const result = await orderStatusLookup({
      phone:       ctx.conversation.phone,
      ...(ctx.customer?.gid != null ? { customerGid: ctx.customer.gid } : {}),
    })

    toolCalls.push({
      name:  'orderStatusLookup',
      input: { phone: ctx.conversation.phone, customerGid: ctx.customer?.gid },
      ok:    true,
    })

    // Map status to a template category.
    // 'cancelled' and 'refunded' use the generic delivered/not-found path since
    // they aren't listed in the 4-template spec — reply with actionable fallback.
    switch (result.status) {
      case 'paid':
      case 'fulfilled':
      case 'shipped':
      case 'delivered': {
        prose = pickSupportTemplate(result.status, {
          orderName: result.orderName,
          ...(result.trackingUrl    != null ? { trackingUrl:    result.trackingUrl }    : {}),
          ...(result.trackingNumber != null ? { trackingNumber: result.trackingNumber } : {}),
          ...(result.carrier        != null ? { carrier:        result.carrier }        : {}),
          ...(result.lastScan       != null ? { lastScan:       result.lastScan }       : {}),
        })
        break
      }
      case 'cancelled': {
        prose = `Order ${result.orderName} was cancelled. If you think that's a mistake, email hello@xdipx.com and we'll look into it right away.`
        break
      }
      case 'refunded': {
        prose = `Order ${result.orderName} has been refunded. It can take 5-7 business days to appear on your statement. Questions? Email hello@xdipx.com.`
        break
      }
      default: {
        prose = `I found ${result.orderName}, but the status is a bit unclear on my end. Email hello@xdipx.com with your order number and we'll get it sorted.`
        break
      }
    }
  } catch (err) {
    if (err instanceof OrderNotFoundError) {
      toolCalls.push({
        name:  'orderStatusLookup',
        input: { phone: ctx.conversation.phone, customerGid: ctx.customer?.gid },
        ok:    false,
        error: err.message,
      })
      prose = NOT_FOUND_REPLY
    } else {
      // Unexpected error — degrade gracefully
      console.error('[sms-v2/support] orderStatusLookup unexpected error', err)
      toolCalls.push({
        name:  'orderStatusLookup',
        input: { phone: ctx.conversation.phone, customerGid: ctx.customer?.gid },
        ok:    false,
        error: err instanceof Error ? err.message : String(err),
      })
      prose = `I'm having trouble pulling up your order right now. Email hello@xdipx.com with your order number and we'll get back to you quickly.`
    }
  }

  return {
    stageOut:     resolveTransition('SUPPORT', 'SUPPORT'),
    goalAchieved: false,
    segments:     [{ prose }],
    stateWrites:  { stage: 'SUPPORT' },
    telemetry: {
      intent:           intent.intent,
      intentConfidence: intent.confidence,
      toolCalls,
    },
  }
}
