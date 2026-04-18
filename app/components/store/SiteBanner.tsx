import { Link } from 'react-router'
import type { SiteBanner as SiteBannerData } from '~/types/cms'

export function SiteBanner({ banner }: { banner?: SiteBannerData | null }) {
  if (!banner?.enabled || !banner.imageUrl) return null

  const img = (
    <img
      src={banner.imageUrl}
      alt={banner.imageAlt ?? ''}
      className="w-full h-auto block"
      loading="eager"
      decoding="async"
    />
  )

  if (!banner.link) {
    return <div className="w-full">{img}</div>
  }

  const isExternal = /^https?:\/\//i.test(banner.link)
  return isExternal ? (
    <a href={banner.link} className="block w-full" target="_blank" rel="noopener noreferrer">
      {img}
    </a>
  ) : (
    <Link to={banner.link} className="block w-full">
      {img}
    </Link>
  )
}
