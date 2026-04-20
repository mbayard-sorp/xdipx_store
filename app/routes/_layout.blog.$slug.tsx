import { redirect, type LoaderFunctionArgs } from 'react-router'

export function loader({ params, request }: LoaderFunctionArgs) {
  const slug = params['slug'] ?? ''
  const url = new URL(request.url)
  return redirect(`/notebook/${slug}${url.search}`, 301)
}

export default function BlogPostRedirect() {
  return null
}
