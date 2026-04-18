import type { LoaderFunctionArgs } from 'react-router'
import { count, eq } from 'drizzle-orm'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { voicemails } from '~/../db/schema'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const rows = await db
    .select({ count: count() })
    .from(voicemails)
    .where(eq(voicemails.status, 'new'))
  return Response.json({ count: rows[0]?.count ?? 0 })
}
