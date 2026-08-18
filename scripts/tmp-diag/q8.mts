import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL!)
console.log('=== APPROVED + still draft (publish-eligible or time bombs) ===')
const a = await sql`select id, platform, review_status, scheduled_for, media_urls::text as mu, feedback is not null as hasfb, left(coalesce(feedback,''),80) as fb from social_posts where status='draft' and review_status='approved' order by id`
for (const r of a as any[]) { const n=(String(r.mu||'').match(/https?:/g)||[]).length
  console.log(`  ${r.id} ${r.platform} media=${n} sched=${String(r.scheduled_for??'').slice(0,10)} stamp=${String(r.fb).startsWith('[publish-gate')?'YES':'NO'} ${String(r.fb).slice(0,60)}`) }
console.log('\n=== PENDING_REVIEW drafts (gate-eligible) ===')
const p = await sql`select id, platform, scheduled_for, media_urls::text as mu from social_posts where status='draft' and review_status='pending_review' order by id`
for (const r of p as any[]) { const n=(String(r.mu||'').match(/https?:/g)||[]).length
  console.log(`  ${r.id} ${r.platform} media=${n} sched=${String(r.scheduled_for??'').slice(0,10)}`) }
console.log('\n=== ticket 3412 ===')
const t = await sql`select id,status,kind,left(suggestion,600) s from homepage_team_suggestions where id=3412`
for (const r of t as any[]) console.log(r.id, r.status, r.kind, '\n', r.s)
