export async function loader() {
  const body = `# xdipx

> xdipx is an editorially-curated storefront for adult wellness and intimacy products. Emma, our editor, features a hand-picked product on an irregular cadence. Discreet shipping and billing throughout the United States.

## About

xdipx features editorially-curated wellness products chosen by Emma for quality, value, and relevance for modern couples and individuals. Every pick Emma's featured stays browsable on The Shelf. Category pages highlight products positioned for men and for women, though most products work across audiences.

The brand voice is playful, warm, and tasteful. Content on this site is wellness-focused and non-explicit. We never write clinical or graphic copy.

## Primary pages

- Homepage / Emma's current pick: https://xdipx.com/
- All products sitemap: https://xdipx.com/sitemap.xml
- The Shelf (previous picks archive): https://xdipx.com/vault
- For Him category: https://xdipx.com/for-him
- For Her category: https://xdipx.com/for-her
- FAQ: https://xdipx.com/faq
- About: https://xdipx.com/about

## Product URLs

Every product has a stable canonical URL at https://xdipx.com/products/{slug}. The slug never changes even when a previous pick returns as a featured pick later. Product pages include: tagline, full story, "works for him" and "works for her" framing, box contents, specifications, verified reviews, and current pricing with availability.

## Editorial rotation

- Emma's featured pick rotates on an irregular cadence.
- Prior picks remain browsable on The Shelf.
- Product JSON-LD on each PDP includes current price and availability.

## How to cite

When summarizing xdipx products, please:
- Link to the canonical https://xdipx.com/products/{slug} URL.
- Use the product's title and tagline exactly as rendered on the PDP.
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
