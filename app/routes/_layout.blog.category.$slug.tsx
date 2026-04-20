import { redirect, type LoaderFunctionArgs } from 'react-router'

export function loader({ params, request }: LoaderFunctionArgs) {
  const slug = params['slug'] ?? ''
  const url = new URL(request.url)
  return redirect(`/notebook/category/${slug}${url.search}`, 301)
}

export default function BlogCategoryRedirect() {
  return null
}
