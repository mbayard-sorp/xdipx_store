import { redirect } from 'react-router'

export async function loader() {
  return redirect('/admin/collections-mgr', 301)
}
