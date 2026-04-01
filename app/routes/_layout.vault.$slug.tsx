import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'

// Vault deal pages are permanent redirects to canonical product URLs
export async function loader({ params }: LoaderFunctionArgs) {
  return redirect(`/products/${params['slug']}`, 301)
}

export default function VaultSlug() { return null }
