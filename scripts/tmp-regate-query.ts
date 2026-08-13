import 'dotenv/config'
import { db } from '../app/lib/db.server'
import { socialPosts } from '../db/schema'
import { desc, eq, and } from 'drizzle-orm'

async function main() {
  const recent = await db.select().from(socialPosts)
    .where(and(eq(socialPosts.platform, 'instagram'), eq(socialPosts.status, 'posted')))
    .orderBy(desc(socialPosts.postedAt))
    .limit(14)
  console.log('--- recent posted IG posts ---')
  for (const p of recent) {
    console.log(p.id, p.postedAt, JSON.stringify((p.editedText||p.tweetText).slice(0,150)))
  }

  console.log('\n--- draft id 34 ---')
  const d34 = await db.select().from(socialPosts).where(eq(socialPosts.id, 34))
  console.log(JSON.stringify(d34, null, 2))

  console.log('\n--- pending_review instagram, most recent 20 ---')
  const pending = await db.select().from(socialPosts)
    .where(and(eq(socialPosts.platform, 'instagram'), eq(socialPosts.reviewStatus, 'pending_review')))
    .orderBy(desc(socialPosts.id))
    .limit(20)
  for (const p of pending) {
    console.log(p.id, p.scheduledFor, p.reviewStatus, JSON.stringify((p.editedText||p.tweetText).slice(0,90)), p.mediaUrls)
  }
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
