function getPreviewPath(type, doc) {
  switch (type) {
    case 'blogPost':
      return doc?.slug?.current ? `/blog/${doc.slug.current}` : null
    case 'page':
      return doc?.slug?.current ? `/pages/${doc.slug.current}` : null
    case 'productPage':
      return doc?.shopifyHandle ? `/products/${doc.shopifyHandle}` : null
    case 'blogCategory':
      return doc?.slug?.current ? `/blog/category/${doc.slug.current}` : null
    case 'homepageSections':
      return '/'
    case 'blogHomepage':
      return '/blog'
    default:
      return null
  }
}

function buildPreviewUrl(path) {
  const origin = process.env.SANITY_STUDIO_PREVIEW_URL || 'http://localhost:3000'
  const secret = process.env.SANITY_STUDIO_PREVIEW_SECRET
  if (!secret) return null
  return `${origin}/api/sanity-preview?secret=${encodeURIComponent(secret)}&slug=${encodeURIComponent(path)}`
}

export function openPreviewAction(props) {
  const {type, published, draft} = props
  const doc = draft || published
  const path = getPreviewPath(type, doc)

  return {
    label: 'Open Preview',
    icon: () => '👁',
    disabled: !path,
    title: path ? `Preview at ${path}` : 'Save the document with a slug first',
    onHandle: () => {
      const url = buildPreviewUrl(path)
      if (url) window.open(url, '_blank')
      props.onComplete()
    },
  }
}

export function copyPreviewLinkAction(props) {
  const {type, published, draft} = props
  const doc = draft || published
  const path = getPreviewPath(type, doc)

  return {
    label: 'Copy Preview Link',
    icon: () => '🔗',
    disabled: !path,
    title: path ? `Copy preview link for ${path}` : 'Save the document with a slug first',
    onHandle: async () => {
      const url = buildPreviewUrl(path)
      if (url) {
        try {
          await navigator.clipboard.writeText(url)
        } catch {
          // Fallback for contexts where clipboard API is unavailable
          prompt('Copy this preview link:', url)
        }
      }
      props.onComplete()
    },
  }
}
