import 'dotenv/config'
import { db } from '../app/lib/db.server'
import { socialPosts } from '../db/schema'
import { eq } from 'drizzle-orm'

async function main() {
  const rows = await db.select().from(socialPosts).where(eq(socialPosts.id, 23))
  console.log(JSON.stringify(rows, null, 2))
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
