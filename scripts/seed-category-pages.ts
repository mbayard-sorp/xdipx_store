/**
 * scripts/seed-category-pages.ts
 *
 * One-shot bootstrap for the merchandised-pages program (homepage
 * merchandising plan, Phase D2). Seeds skeleton documents the agent team then
 * enriches during the staged initial merchandising run:
 *
 *   categoryPage-pleasure   /collections/pleasure   (already live in prod — no-op there)
 *   categoryPage-play       /collections/play
 *   categoryPage-body       /collections/body
 *   categoryPage-wear       /collections/wear
 *   categoryPage-discover   /collections/discover
 *   dropPage-new            /new
 *   dropPage-on-sale        /collections/on-sale
 *   drafts.singleton.storefrontHome   homepage layout DRAFT (deck marker disabled)
 *
 * Safety properties:
 *   - Every write is createIfNotExists: re-running never clobbers content the
 *     team or the owner has since edited.
 *   - Every new page ships status:'draft', which the category resolver treats
 *     as absent — nothing becomes visible on the storefront by running this.
 *   - The layout doc is seeded as the STUDIO DRAFT (drafts.singleton.…), so
 *     flipping the homepage stays an explicit owner publish in Sanity Studio,
 *     and its panelDeckSection marker ships enabled:false (two-key flip).
 *   - Skeleton copy is deliberately neutral Emma voice: no claims that need a
 *     source, CTAs from the whitelist, no urgency, no em-dashes.
 *
 * Usage:
 *   npx tsx scripts/seed-category-pages.ts --dry-run   # print the plan
 *   npx tsx scripts/seed-category-pages.ts             # write
 */
import 'dotenv/config'
import { createClient } from '@sanity/client'

const projectId = process.env['SANITY_PROJECT_ID']
const dataset   = process.env['SANITY_DATASET'] ?? 'production'
const token     =
  process.env['SANITY_API_TOKEN'] ??
  process.env['SANITY_WRITE_TOKEN'] ??
  process.env['SANITY_TOKEN']

const dryRun = process.argv.includes('--dry-run')

interface Shelf {
  key: string
  title: string
  collectionHandle: string
  intro: string
}

/** Standard block spine every category page starts from. */
function categoryPageDoc(opts: {
  id: string
  title: string
  handle: string
  kicker: string
  headline: string
  italicWord: string
  standfirst: string
  shelves: Shelf[]
  faq: { question: string; answer: string }[]
}): Record<string, unknown> {
  return {
    _id: opts.id,
    _type: 'categoryPage',
    title: opts.title,
    shopifyCollectionHandle: opts.handle,
    status: 'draft',
    blocks: [
      {
        _key: 'masthead',
        _type: 'categoryMasthead',
        anchorId: 'top',
        kicker: opts.kicker,
        headline: opts.headline,
        italicWord: opts.italicWord,
        standfirst: opts.standfirst,
      },
      {
        _key: 'nav',
        _type: 'shelfNav',
        anchorId: 'shelves',
        label: 'Jump to',
        showCounts: true,
        sticky: true,
      },
      ...opts.shelves.map(s => ({
        _key: `shelf-${s.key}`,
        _type: 'shelfSection',
        anchorId: `shelf-${s.key}`,
        title: s.title,
        collectionHandle: s.collectionHandle,
        intro: s.intro,
        seeAllLabel: 'See all →',
      })),
      {
        _key: 'trust',
        _type: 'categoryTrust',
        anchorId: 'trust',
        items: [
          { _key: 't1', _type: 'categoryTrustItem', headline: 'Plain brown box', subheadline: 'Nothing printed on it.' },
          { _key: 't2', _type: 'categoryTrustItem', headline: 'Statement reads XDIPX', subheadline: 'That is all it says.' },
          { _key: 't3', _type: 'categoryTrustItem', headline: 'Secure checkout', subheadline: 'Encrypted end to end.' },
        ],
      },
      {
        _key: 'faq',
        _type: 'faqBlock',
        anchorId: 'faq',
        heading: 'Questions, answered.',
        items: opts.faq.map((f, i) => ({ _key: `q${i + 1}`, _type: 'categoryFaqItem', ...f })),
      },
    ],
  }
}

const PACKAGING_FAQ = {
  question: 'How discreet is the packaging really?',
  answer:
    'Completely plain. The box carries no brand name, no product wording, and the card statement reads XDIPX and nothing else.',
}

const DOCS: Record<string, unknown>[] = [
  categoryPageDoc({
    id: 'categoryPage-pleasure',
    title: 'Pleasure aisle',
    handle: 'pleasure',
    kicker: 'The pleasure aisle',
    headline: 'Built for the feeling you are after.',
    italicWord: 'feeling',
    standfirst:
      'Vibrators, dildos, and the rest of the toybox, shelved by what they do rather than what they are called. Start with the shelf that sounds like you.',
    shelves: [
      { key: 'vibrators', title: 'Vibrators', collectionHandle: 'vibrators', intro: 'Broad strokes to pinpoint, quiet to insistent.' },
      { key: 'dildos', title: 'Dildos', collectionHandle: 'dildos', intro: 'Shape and firmness do the talking here.' },
      { key: 'for-him', title: 'For him', collectionHandle: 'for-him', intro: 'Strokers and sleeves, from first try to daily driver.' },
      { key: 'anal', title: 'Anal', collectionHandle: 'anal', intro: 'Sized honestly, flared always.' },
    ],
    faq: [
      PACKAGING_FAQ,
      {
        question: 'What is the difference between a vibrator and a wand?',
        answer:
          'A wand is a vibrator with a large rounded head and most of its power spread broad, which suits people who prefer wide, rumbling pressure. Smaller vibrators focus the same idea into a point.',
      },
    ],
  }),
  categoryPageDoc({
    id: 'categoryPage-play',
    title: 'Play aisle',
    handle: 'play',
    kicker: 'The play aisle',
    headline: 'For the two of you, or the game you play.',
    italicWord: 'game',
    standfirst:
      'Restraints, blindfolds, couples toys, and the props that turn a night in into a scene. Shelved from a first blindfold to full kit.',
    shelves: [
      { key: 'bondage', title: 'Bondage and kink', collectionHandle: 'all-bondage', intro: 'From a silk blindfold to serious hardware.' },
      { key: 'restraints', title: 'Restraints', collectionHandle: 'restraints', intro: 'Cuffs and ties that hold without hurting.' },
      { key: 'couples', title: 'Couples', collectionHandle: 'couples', intro: 'Toys built for two sets of hands.' },
      { key: 'games', title: 'Games and romance', collectionHandle: 'games-romance', intro: 'A low-stakes way to start the conversation.' },
    ],
    faq: [
      PACKAGING_FAQ,
      {
        question: 'Where should a beginner start with bondage?',
        answer:
          'Soft restraints or a blindfold. Both are easy to put on, easy to take off, and give you the feeling of the thing without any technique to learn. Agree on a stop word before you start.',
      },
    ],
  }),
  categoryPageDoc({
    id: 'categoryPage-body',
    title: 'Body aisle',
    handle: 'body',
    kicker: 'The body aisle',
    headline: 'The part your skin notices first.',
    italicWord: 'skin',
    standfirst:
      'Lubricants, massage, arousal, and aftercare. The quiet half of the drawer that makes everything else in it feel better.',
    shelves: [
      { key: 'lubricants', title: 'Lubricants', collectionHandle: 'lubricants', intro: 'Water, silicone, or hybrid. Match it to your toys.' },
      { key: 'massage', title: 'Massage and mood', collectionHandle: 'massage-mood', intro: 'Oils and candles for the slow opening act.' },
      { key: 'arousal', title: 'Arousal', collectionHandle: 'enhancers-arousal', intro: 'Gels and enhancers that turn the dial up.' },
      { key: 'wellness', title: 'Wellness and care', collectionHandle: 'wellness-care', intro: 'Cleaners, kegels, and the sensible aftercare shelf.' },
    ],
    faq: [
      PACKAGING_FAQ,
      {
        question: 'Which lube works with silicone toys?',
        answer:
          'Water-based lube is safe with every toy material including silicone. Silicone lube lasts longer on skin but can degrade silicone toys, so keep it for glass, steel, or bare skin.',
      },
    ],
  }),
  categoryPageDoc({
    id: 'categoryPage-wear',
    title: 'Wear aisle',
    handle: 'wear',
    kicker: 'The wear aisle',
    headline: 'Dressed for the way it comes off.',
    italicWord: 'off',
    standfirst:
      'Lingerie, bodysuits, fetishwear, and the accessories that finish the look. Cut to be seen, sized to be honest.',
    shelves: [
      { key: 'lingerie', title: 'Lingerie', collectionHandle: 'lingerie', intro: 'Sets and singles, sheer to structured.' },
      { key: 'bodysuits', title: 'Bodysuits and teddies', collectionHandle: 'bodysuits-teddies', intro: 'One piece, one line, all intent.' },
      { key: 'fetishwear', title: 'Fetishwear', collectionHandle: 'fetishwear', intro: 'Leather, latex looks, and harness lines.' },
      { key: 'accessories', title: 'Accessories', collectionHandle: 'accessories', intro: 'Pasties, roleplay, and the finishing touches.' },
    ],
    faq: [
      PACKAGING_FAQ,
      {
        question: 'How do I pick a lingerie size that will actually fit?',
        answer:
          'Use the size chart on each product page rather than your usual street size. Lingerie sizing runs closer to the body, and each listing states the fit its maker cut it for.',
      },
    ],
  }),
  categoryPageDoc({
    id: 'categoryPage-discover',
    title: 'Discover aisle',
    handle: 'discover',
    kicker: 'Discover',
    headline: 'Curated ways in, when the catalog is a lot.',
    italicWord: 'in',
    standfirst:
      'Beginner kits, date night picks, gifts, and the quiet-tech shelf. Short, edited lists for when you would rather browse a shelf than a warehouse.',
    shelves: [
      { key: 'beginners', title: 'Beginner kits', collectionHandle: 'discover-beginner-kits', intro: 'Everything a first drawer needs, chosen gently.' },
      { key: 'date-night', title: 'Date night', collectionHandle: 'discover-date-night', intro: 'Picks that make an evening of it.' },
      { key: 'gifts', title: 'Gifts', collectionHandle: 'discover-gift-guide', intro: 'Giftable, discreet, and easy to get right.' },
      { key: 'whisper-quiet', title: 'Whisper quiet', collectionHandle: 'discover-whisper-quiet', intro: 'For thin walls and shared houses.' },
    ],
    faq: [
      PACKAGING_FAQ,
      {
        question: 'What makes a good first toy?',
        answer:
          'Something small, body-safe, and adjustable. A bullet vibe or a beginner kit lets you find what you like at your own pace, and silicone with a simple control is the forgiving place to start.',
      },
    ],
  }),
  {
    _id: 'dropPage-new',
    _type: 'dropPage',
    title: 'New arrivals',
    routeKey: 'new',
    status: 'draft',
    sourceRule: { kind: 'tag', tag: 'new-arrival' },
    blocks: [
      {
        _key: 'masthead',
        _type: 'dropMasthead',
        anchorId: 'top',
        period: 'Recently landed',
        headline: 'New on the shelf.',
        italicWord: 'New',
        standfirst:
          'The latest arrivals, added as they clear our curation pass. New picks land on an irregular schedule, so this page changes when the shelf does.',
      },
      {
        _key: 'coming-soon',
        _type: 'comingSoon',
        anchorId: 'coming-soon',
        heading: 'More on the way.',
        body: 'Emma adds new picks on an irregular schedule. The Notebook is where they get written up first.',
        ctaLabel: 'Take a peek →',
      },
    ],
  },
  {
    _id: 'dropPage-on-sale',
    _type: 'dropPage',
    title: 'Sale',
    routeKey: 'on-sale',
    status: 'draft',
    sourceRule: { kind: 'tag', tag: 'on-sale' },
    blocks: [
      {
        _key: 'masthead',
        _type: 'dropMasthead',
        anchorId: 'top',
        period: 'Current markdowns',
        headline: 'Good picks, quieter prices.',
        italicWord: 'quieter',
        standfirst:
          'The same curation, marked down. Prices shown are the best we are allowed to advertise, and everything here ships in the same plain box.',
      },
      {
        _key: 'makers-note',
        _type: 'makersNote',
        anchorId: 'note',
        heading: 'Why things end up here',
        body:
          'A pick goes on sale when a maker updates a line or our shelf space moves on, never because something is wrong with it. Same products, same guarantee.',
      },
    ],
  },
  // The homepage layout ships as the STUDIO DRAFT. Publishing it is the
  // owner's explicit flip step (Phase E), and the deck marker inside it ships
  // disabled so the deck needs its own second key even after that publish.
  {
    _id: 'drafts.singleton.storefrontHome',
    _type: 'storefrontHome',
    note: 'Seeded default order. Deck marker present but disabled.',
    sections: [
      { _key: 'band-hero', _type: 'homeBand', band: 'hero', enabled: true },
      { _key: 'deck', _type: 'panelDeckSection', enabled: false },
      { _key: 'band-anchorGrid', _type: 'homeBand', band: 'anchorGrid', enabled: true },
      { _key: 'band-teamRails', _type: 'homeBand', band: 'teamRails', enabled: true },
      { _key: 'band-meetEmma', _type: 'homeBand', band: 'meetEmma', enabled: true },
      { _key: 'band-wayfinder', _type: 'homeBand', band: 'wayfinder', enabled: true },
      { _key: 'band-emmasEdit', _type: 'homeBand', band: 'emmasEdit', enabled: true },
      { _key: 'band-sensationMap', _type: 'homeBand', band: 'sensationMap', enabled: true },
      { _key: 'band-couples', _type: 'homeBand', band: 'couples', enabled: true },
      { _key: 'band-stillDeciding', _type: 'homeBand', band: 'stillDeciding', enabled: true },
      { _key: 'band-notebook', _type: 'homeBand', band: 'notebook', enabled: true },
      { _key: 'band-faq', _type: 'homeBand', band: 'faq', enabled: true },
      { _key: 'band-emailCapture', _type: 'homeBand', band: 'emailCapture', enabled: true },
    ],
  },
]

async function main(): Promise<void> {
  if (dryRun) {
    for (const doc of DOCS) {
      const blocks = Array.isArray(doc['blocks']) ? (doc['blocks'] as unknown[]).length : undefined
      const sections = Array.isArray(doc['sections']) ? (doc['sections'] as unknown[]).length : undefined
      console.log(
        JSON.stringify({
          wouldCreateIfNotExists: doc['_id'],
          type: doc['_type'],
          ...(doc['status'] ? { status: doc['status'] } : {}),
          ...(blocks !== undefined ? { blocks } : {}),
          ...(sections !== undefined ? { sections } : {}),
        }),
      )
    }
    return
  }

  if (!projectId || !token) {
    console.error('Missing SANITY_PROJECT_ID or SANITY_API_TOKEN (or SANITY_WRITE_TOKEN) in the environment')
    process.exit(1)
  }
  const client = createClient({ projectId, dataset, apiVersion: '2024-10-01', useCdn: false, token })

  for (const doc of DOCS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await client.createIfNotExists(doc as any)
    const created = res._rev !== undefined && res._createdAt === res._updatedAt
    console.log(JSON.stringify({ id: doc['_id'], existed: !created }))
  }
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
