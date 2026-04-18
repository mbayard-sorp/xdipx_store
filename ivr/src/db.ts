/**
 * Neon + Drizzle client for the IVR service. Uses the same DATABASE_URL as
 * the Vercel app. Neon's serverless HTTP driver is safe in both environments
 * and keeps us off long-lived Postgres connections (avoids pool exhaustion).
 */
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import type { CallEndReason } from './config.ts'

const url = process.env['DATABASE_URL']
if (!url) console.warn('[ivr] DATABASE_URL not set — DB writes will fail')

const sql = neon(url ?? '')
export const db = drizzle(sql)

/** Minimal row type — we don't pull the full schema into this service. */
export interface VoicemailInsert {
  callSid: string
  fromNumber: string
  callbackNumber: string | null
  summary: string
  transcript: string
  recordingUrl: string | null
  contextOrderNumber: string | null
}

export interface CallLogInsert {
  callSid: string
  fromNumber: string
  toNumber: string | null
  endReason: CallEndReason
  durationSec: number
  tokensTotal: number
}

export async function recordCall(row: CallLogInsert): Promise<void> {
  await sql(
    `INSERT INTO call_log
       (call_sid, from_number, to_number, direction, end_reason, duration_sec, tokens_total)
     VALUES ($1, $2, $3, 'inbound', $4, $5, $6)
     ON CONFLICT (call_sid) DO UPDATE SET
       end_reason   = EXCLUDED.end_reason,
       duration_sec = EXCLUDED.duration_sec,
       tokens_total = EXCLUDED.tokens_total`,
    [row.callSid, row.fromNumber, row.toNumber, row.endReason, row.durationSec, row.tokensTotal],
  )
}

export async function insertVoicemail(row: VoicemailInsert): Promise<void> {
  await sql(
    `INSERT INTO voicemails
       (call_sid, from_number, callback_number, summary, transcript, recording_url, context_order_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (call_sid) DO UPDATE SET
       summary = EXCLUDED.summary,
       transcript = EXCLUDED.transcript,
       callback_number = EXCLUDED.callback_number,
       context_order_number = EXCLUDED.context_order_number`,
    [
      row.callSid,
      row.fromNumber,
      row.callbackNumber,
      row.summary,
      row.transcript,
      row.recordingUrl,
      row.contextOrderNumber,
    ],
  )
}
