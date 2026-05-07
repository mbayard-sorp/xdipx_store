/**
 * scripts/test-conversation-memory.ts
 *
 * QA memory observability script — sends a 4-turn synthetic conversation
 * through processSmsMessageV2 (the real production entry point) and prints
 * the sms_conversations row after each turn so you can watch memory propagate.
 *
 * Fields printed per turn:
 *   phone, stage, currentPitchHandle, conversation_summary, pitched_handles_log
 *
 * Usage:
 *   npx tsx scripts/test-conversation-memory.ts
 *   npx tsx scripts/test-conversation-memory.ts --phone +15555550199
 *
 * Defaults to +15555550100 (test sentinel that never matches a real customer).
 * Safe to run repeatedly — clears the test conversation row before each run.
 *
 * Requires: DATABASE_URL (preview DB), ANTHROPIC_API_KEY, SHOPIFY_* env vars.
 * Run from the worktree root after `bash scripts/setup-worktree.sh` so .env
 * is symlinked.
 */

// Load env before any imports that reference process.env
import { config } from 'dotenv'
config({ path: '.env' })
config({ path: '.env.local', override: true })

import { eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server.js'
import { smsConversations } from '../db/schema.js'
import { processSmsMessageV2 } from '../app/lib/sms-v2/processor.server.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_TEST_PHONE = '+15555550100'

function parseArgs(): { phone: string } {
  const args = process.argv.slice(2)
  const phoneIdx = args.findIndex((a) => a === '--phone')
  return {
    phone: phoneIdx >= 0 ? (args[phoneIdx + 1] ?? DEFAULT_TEST_PHONE) : DEFAULT_TEST_PHONE,
  }
}

// The 4-turn test conversation per QA spec.
const TEST_TURNS = [
  'looking for something quiet for my partner',
  "she's never bought a toy before",
  '$80 max',
  'what was that first one you mentioned again?',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearTestRow(phone: string): Promise<void> {
  await db.delete(smsConversations).where(eq(smsConversations.phone, phone))
  console.log(`[reset] cleared conversation row for ${phone}`)
}

async function readRow(phone: string): Promise<typeof smsConversations.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(smsConversations)
    .where(eq(smsConversations.phone, phone))
    .limit(1)
  return rows[0]
}

function printRow(row: typeof smsConversations.$inferSelect | undefined, turn: number): void {
  if (!row) {
    console.log(`  [turn ${turn}] no row found in DB`)
    return
  }
  console.log(`  phone:               ${row.phone}`)
  console.log(`  stage:               ${row.stage}`)
  console.log(`  currentPitchHandle:  ${row.currentPitchHandle ?? '(none)'}`)
  console.log(`  conversation_summary: ${row.conversationSummary ?? '(none)'}`)
  console.log(
    `  pitched_handles_log: ${row.pitchedHandlesLog?.length ? JSON.stringify(row.pitchedHandlesLog) : '(empty)'}`,
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { phone } = parseArgs()

  console.log(`\n${'='.repeat(70)}`)
  console.log(`CONVERSATION MEMORY TEST  phone=${phone}`)
  console.log('='.repeat(70))

  // Step 0: clear any leftover row so we start clean.
  await clearTestRow(phone)

  for (let i = 0; i < TEST_TURNS.length; i++) {
    const text = TEST_TURNS[i]!
    const turnNum = i + 1

    console.log(`\n${'─'.repeat(70)}`)
    console.log(`TURN ${turnNum}: "${text}"`)
    console.log('─'.repeat(70))

    let reply = ''
    try {
      const result = await processSmsMessageV2({
        from: phone,
        body: text,
        simulated: true, // prevents Klaviyo consent writes + Twilio delivery
      })
      // result is an array of SmsSegment or a flat string depending on version.
      if (Array.isArray(result)) {
        reply = result.map((s: { body?: string; text?: string }) => s.body ?? s.text ?? '').join(' ')
      } else if (typeof result === 'string') {
        reply = result
      } else if (result && typeof (result as { body?: string }).body === 'string') {
        reply = (result as { body: string }).body
      } else {
        reply = JSON.stringify(result)
      }
    } catch (err) {
      console.error(`  [turn ${turnNum}] processSmsMessageV2 threw:`, err)
    }

    // The summary is written fire-and-forget in the agent, so give it a moment
    // to propagate before we read the row. 1 200ms delay is enough in practice.
    await new Promise((r) => setTimeout(r, 1200))

    const row = await readRow(phone)
    console.log(`  Emma: ${reply.slice(0, 200)}${reply.length > 200 ? '...' : ''}`)
    console.log('')
    printRow(row, turnNum)
  }

  console.log(`\n${'='.repeat(70)}`)
  console.log('TEST COMPLETE')
  console.log('='.repeat(70))
  process.exit(0)
}

main().catch((err) => {
  console.error('[test-conversation-memory] fatal:', err)
  process.exit(1)
})
