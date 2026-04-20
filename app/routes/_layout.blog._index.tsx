import { redirect, type LoaderFunctionArgs } from 'react-router'

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  return redirect(`/notebook${url.search}`, 301)
}

export default function BlogIndexRedirect() {
  return null
}
