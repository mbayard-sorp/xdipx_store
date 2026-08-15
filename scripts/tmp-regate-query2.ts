import 'dotenv/config'
import { db } from '../app/lib/db.server'
import { socialPosts } from '../db/schema'
import { desc, eq, and, sql, like } from 'drizzle-orm'

async function main() {
  const statusCounts = await db.execute(sql`select platform, status, review_status, count(*) from social_posts group by 1,2,3 order by 1,2,3`)
  console.log('--- status breakdown ---')
  console.log(statusCounts.rows)

  console.log('\n--- all instagram posted-ish, newest first ---')
  const all = await db.select().from(socialPosts)
    .where(eq(socialPosts.platform, 'instagram'))
    .orderBy(desc(socialPosts.id))
    .limit(40)
  for (const p of all) {
    console.log(p.id, p.status, p.reviewStatus, p.postedAt, p.scheduledFor, JSON.stringify((p.editedText||p.tweetText).slice(0,70)))
  }

  console.log('\n--- search for bullet caption ---')
  const bullet = await db.select().from(socialPosts).where(like(socialPosts.tweetText, '%bullet vibrators%'))
  console.log(JSON.stringify(bullet, null, 2))
  const bulletEdited = await db.select().from(socialPosts).where(like(socialPosts.editedText, '%bullet vibrators%'))
  console.log(JSON.stringify(bulletEdited, null, 2))
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
