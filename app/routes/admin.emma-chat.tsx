import { redirect } from 'react-router'

/** Legacy URL — the chat consoles merged into /admin/chat/:persona. */
export async function loader() {
  return redirect('/admin/chat/emma', 308)
}
