/**
 * app/lib/sms-v2/processor.server.ts
 *
 * Phase 0.5: pass-through to v1. Phase 1+ replace this with the real
 * conversation-entity + intent-classifier + stage-handler pipeline.
 *
 * The contract MUST stay byte-identical to processSmsMessage. Any drift
 * means dark-launch comparisons are invalid.
 */
import { processSmsMessage } from '~/lib/sms-processor.server'

// Re-export types so callers can switch by import only — no re-definition needed.
export type { ProcessSmsInput, ProcessSmsResult, SmsSegment } from '~/lib/sms-processor.server'

export async function processSmsMessageV2(
  input: Parameters<typeof processSmsMessage>[0],
): Promise<Awaited<ReturnType<typeof processSmsMessage>>> {
  return processSmsMessage(input)
}
