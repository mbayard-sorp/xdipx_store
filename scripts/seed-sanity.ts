/**
 * Seed Sanity with starter homepage blocks.
 * Run once: npx tsx scripts/seed-sanity.ts
 *
 * Safe to re-run — uses createOrReplace, so it overwrites the document.
 */
import 'dotenv/config'
import { createClient } from '@sanity/client'

const projectId = process.env['SANITY_PROJECT_ID']
const dataset   = process.env['SANITY_DATASET'] ?? 'production'
const token     = process.env['SANITY_API_TOKEN']

if (!projectId || !token) {
  console.error('Missing SANITY_PROJECT_ID or SANITY_API_TOKEN in .env')
  process.exit(1)
}

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-10-01',
  useCdn: false,
  token,
})

// ─── Seed singleton.homepage ──────────────────────────────────────────────────

await client.createOrReplace({
  _id:  'singleton.homepage',
  _type: 'homepageSections',
  sections: [
    // ── Announcement Bar ─────────────────────────────────────────────────────
    {
      _key: 'announcementBar-starter',
      _type: 'announcementBar',
      active: true,
      order: 1,
      messages: [
        { _key: 'msg-1', text: 'Free shipping on orders over $49 ♥' },
        { _key: 'msg-2', text: 'New deal every day at midnight — don\'t miss it' },
        { _key: 'msg-3', text: 'Ships in 100% discreet packaging. Always.' },
      ],
      rotationIntervalMs: 4000,
      bgStyle: 'coral',
    },

    // ── Promo Banner ─────────────────────────────────────────────────────────
    {
      _key: 'promoBanner-starter',
      _type: 'promoBanner',
      active: true,
      order: 2,
      headline: 'Free gift with every order over $75 ♥',
      subtext:  'Limited time offer — while supplies last.',
      ctaLabel: 'Shop Today\'s Deal',
      ctaLink:  '/',
      layout:   'text-only',
      bgStyle:  'gradient',
    },

    // ── Category Grid ────────────────────────────────────────────────────────
    {
      _key: 'categoryGrid-starter',
      _type: 'categoryGrid',
      active: true,
      order: 5,
      eyebrow: 'Find Your Vibe',
      heading: 'Shop by Category',
      columns: 4,
      items: [
        { _key: 'cat-1', label: 'For Her',     emoji: '🌸', link: '/for-her' },
        { _key: 'cat-2', label: 'For Him',     emoji: '⚡', link: '/for-him' },
        { _key: 'cat-3', label: 'Couples',     emoji: '♥',  link: '/vault'   },
        { _key: 'cat-4', label: 'Best Deals',  emoji: '🔥', link: '/vault'   },
      ],
    },

    // ── Play Together Banner ─────────────────────────────────────────────────
    {
      _key: 'playTogether-starter',
      _type: 'playTogetherBanner',
      active: true,
      order: 7,
      eyebrow: 'Better Together',
      heading: 'Play together. Grow closer. ♥',
      body:    'The best relationships are the ones where you keep discovering each other. Our couples picks are chosen to spark something new — no experience required.',
      ctaLabel: 'Explore Couples Picks',
      ctaLink:  '/vault',
      imagePosition: 'right',
    },

    // ── Testimonials ─────────────────────────────────────────────────────────
    {
      _key: 'testimonials-starter',
      _type: 'testimonials',
      active: true,
      order: 9,
      eyebrow: 'Real People, Real Love',
      heading: 'What our customers say ♥',
      items: [
        {
          _key: 'review-1',
          quote:    'Amazing deals and super discreet shipping. I\'ve ordered three times already!',
          author:   'Sarah M.',
          rating:   5,
          verified: true,
        },
        {
          _key: 'review-2',
          quote:    'Best prices I\'ve found anywhere online. The daily deal concept is genius.',
          author:   'Jake T.',
          rating:   5,
          verified: true,
        },
        {
          _key: 'review-3',
          quote:    'Fast shipping, no awkward packaging, great products. Couldn\'t be happier.',
          author:   'Alex R.',
          rating:   5,
          verified: true,
        },
        {
          _key: 'review-4',
          quote:    'I set an alarm so I don\'t miss the midnight deal. That\'s how good this site is.',
          author:   'Jordan K.',
          rating:   5,
          verified: true,
        },
      ],
    },
  ],
})

console.log('✅ singleton.homepage seeded with 5 starter blocks')

// ─── Seed singleton.siteSettings ─────────────────────────────────────────────

await client.createOrReplace({
  _id:  'singleton.siteSettings',
  _type: 'siteSettings',
  socialLinks: [
    { _key: 'x',         platform: 'x',         handle: 'hello_xdipx', url: 'https://x.com/hello_xdipx'                },
    { _key: 'instagram', platform: 'instagram',  handle: 'hello_xdipx', url: 'https://instagram.com/hello_xdipx'       },
    { _key: 'tiktok',    platform: 'tiktok',     handle: 'hello_xdipx', url: 'https://tiktok.com/@hello_xdipx'         },
  ],
})

console.log('✅ singleton.siteSettings seeded with social links')
console.log('')
console.log('Now reload http://localhost:3000 — CMS blocks should appear on the homepage.')
