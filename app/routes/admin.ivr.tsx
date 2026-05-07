import { redirect, type LoaderFunctionArgs } from 'react-router'

/**
 * /admin/ivr is the legacy URL — preserved as a 308 redirect so existing
 * bookmarks / saved tabs / outbound links don't 404 after the rename.
 * The actual page now lives at /admin/voice-and-sms.
 */
export async function loader(_args: LoaderFunctionArgs) {
  return redirect('/admin/voice-and-sms', 308)
}
