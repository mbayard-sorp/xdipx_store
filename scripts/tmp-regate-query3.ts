import 'dotenv/config'
import { db } from '../app/lib/db.server'
import { socialPosts } from '../db/schema'
import { eq } from 'drizzle-orm'

async function main() {
  for (const id of [23,25,24,17,30,26,22]) {
    const rows = await db.select().from(socialPosts).where(eq(socialPosts.id, id))
    const p = rows[0]
    if (!p) continue
    console.log('=== id', id, 'status', p.status, p.reviewStatus, 'postedAt', p.postedAt, '===')
    console.log('CAPTION:', p.editedText || p.tweetText)
    console.log('MEDIA:', p.mediaUrls)
    console.log('FEEDBACK:', p.feedback)
    console.log()
  }
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
