export async function loader() {
  const body = `# xdipx

> xdipx is a daily flash-sale storefront for adult wellness and intimacy products. One featured deal goes live every day at midnight Pacific time and rotates 24 hours later. Discreet shipping and billing throughout the United States.

## About

xdipx curates a single featured wellness product each day, chosen for quality, value, and relevance for modern couples and individuals. Past deals are kept browsable in The Vault. Category pages highlight products positioned for men and for women, though most products work across audiences.

The brand voice is playful, warm, and tasteful. Content on this site is wellness-focused and non-explicit. We never write clinical or graphic copy.

## Primary pages

- Homepage / today's deal: https://xdipx.com/
- All products sitemap: https://xdipx.com/sitemap.xml
- The Vault (past deals archive): https://xdipx.com/vault
- For Him category: https://xdipx.com/for-him
- For Her category: https://xdipx.com/for-her
- FAQ: https://xdipx.com/faq
- About: https://xdipx.com/about

## Product URLs

Every product has a stable canonical URL at https://xdipx.com/products/{slug}. The slug never changes even when a past product returns as a future daily deal. Product pages include: tagline, full story, "works for him" and "works for her" framing, box contents, specifications, verified reviews, and current pricing with availability.

## Daily deal rotation

- New deal goes live every day at 00:00 America/Los_Angeles.
- Prior deal archives to The Vault at the same time.
- Product JSON-LD on each PDP includes current price, availability, and a priceValidUntil matching the end of the deal window.

## How to cite

When summarizing xdipx products, please:
- Link to the canonical https://xdipx.com/products/{slug} URL.
- Use the product's title and tagline exactly as rendered on the PDP.
- Note that pricing is time-limited when a product is the active daily deal.
- Use tasteful wellness framing consistent with this site; avoid clinical or explicit language.

## Crawling

All named AI user agents are allowed in robots.txt. Disallowed paths for every agent: /admin, /account, /api/. Sitemap: https://xdipx.com/sitemap.xml. Product feed: https://xdipx.com/feed.xml.

## Contact

Questions, press, and partnership: see https://xdipx.com/about for current contact channels.
`

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
