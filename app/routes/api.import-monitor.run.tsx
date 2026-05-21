import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  try {
    const { runImportMonitor } = await import('~/lib/import-monitor.server')
    const r = await runImportMonitor({ source: 'manual' })
    return Response.json({ ok: true, ...r })
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
