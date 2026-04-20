/**
 * Dump an Emma chat session + turns for debugging.
 *
 *   npm run emma:log                  → latest session
 *   npm run emma:log -- 42            → session id 42
 *   npm run emma:log -- --list        → list the last 10 sessions
 *   npm run emma:log -- --list 25     → list the last 25 sessions
 */
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env['DATABASE_URL']!)

async function listSessions(limit: number) {
  const rows = await sql`
    SELECT id, turn_count, checkout_shared_at, created_at, last_activity_at, customer_gid
    FROM emma_chat_sessions
    ORDER BY id DESC
    LIMIT ${limit}
  `
  if (rows.length === 0) {
    console.log('No sessions yet.')
    return
  }
  console.log(`── LAST ${rows.length} SESSIONS ──`)
  for (const r of rows) {
    const who = r['customer_gid'] || 'anon'
    const checkout = r['checkout_shared_at'] ? ' ✓checkout' : ''
    const last = new Date(String(r['last_activity_at'])).toISOString().slice(0, 16).replace('T', ' ')
    console.log(`  #${r['id']}  turns=${r['turn_count']}  ${last}  ${who}${checkout}`)
  }
}

async function dumpSession(idArg?: string) {
  const sessionRow = idArg
    ? await sql`SELECT * FROM emma_chat_sessions WHERE id = ${Number(idArg)}`
    : await sql`SELECT * FROM emma_chat_sessions ORDER BY id DESC LIMIT 1`
  if (sessionRow.length === 0) {
    console.log('No session found.')
    return
  }
  const session = sessionRow[0]!
  console.log('── SESSION ──')
  console.log(JSON.stringify(session, null, 2))

  const turns = await sql`
    SELECT id, role, hidden, latency_ms, products, quick_reply, text, created_at
    FROM emma_chat_turns
    WHERE session_id = ${session['id']}
    ORDER BY id ASC
  `
  console.log(`\n── TURNS (${turns.length}) ──`)
  for (const t of turns) {
    const meta = [
      t['role'],
      t['hidden'] ? 'HIDDEN' : null,
      t['latency_ms'] != null ? `${t['latency_ms']}ms` : null,
      Array.isArray(t['products']) && t['products'].length
        ? `products=[${(t['products'] as string[]).join(',')}]`
        : null,
      t['quick_reply'] ? `qr=${JSON.stringify(t['quick_reply'])}` : null,
    ].filter(Boolean).join(' ')
    console.log(`\n#${t['id']} ${meta}`)
    console.log(String(t['text']))
  }
}

async function main() {
  const [arg1, arg2] = process.argv.slice(2)
  if (arg1 === '--list' || arg1 === '-l') {
    const limit = Math.max(1, Math.min(100, Number(arg2 ?? 10)))
    await listSessions(limit)
    return
  }
  await dumpSession(arg1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
