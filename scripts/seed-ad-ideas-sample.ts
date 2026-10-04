/**
 * Seed six sample ad ideas so the owner can rate something on day one
 * (Ad Studio v2, PR-A). Lines are quoted from
 * docs/store-team/ad-creative-concept-bank-2026-10-03.md. Rows carry
 * run_id null and a "sample" utm_campaign so they are easy to find and purge.
 *
 * Idempotent: an idea with the same concept_slug, lane and title and run_id
 * null is skipped, so rerunning never duplicates.
 *
 *   DATABASE_URL=<dev or preview url> npx tsx scripts/seed-ad-ideas-sample.ts
 *
 * Do NOT point this at production. It writes real rows to ad_ideas.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { adIdeas } from '../db/schema'
import { createIdeas, validateIdea, type NewIdeaInput } from '../app/lib/ad-ideas.server'

const BASE = 'https://xdipx.com/products'
const be = { cpa_cents: 1500, roas: 2.2, aov_cents: 3300, gross_margin_pct: 45 }

const raw = [
  {
    concept_slug: 'spec-sheet',
    lane: 'google',
    register_tier: '4-5',
    title: 'Water-based or aloe, side by side',
    one_liner: 'Two lubes, five honest rows, and the reader picks.',
    products: [
      { handle: 'naturals-h2o-intimate-lubricant-8-5-oz', title: 'Sliquid Naturals H2O' },
      { handle: 'lelo-water-based-personal-moisturizer-75-ml-2-5-oz', title: 'LELO Water-Based Moisturizer' },
    ],
    headlines: ['Water-Based or Aloe? Compared', 'Which Lube Suits Silicone?', 'Water-Based Lube, Plainly'],
    body: ['Five rows: base, feel, bottle size, skin notes, best for. Every cell traces to the label.'],
    audience: { network: 'Search', keywords: 'water based lube, aloe lube, lube for silicone toys', age: '18+' },
    destination_url: `${BASE}/naturals-h2o-intimate-lubricant-8-5-oz?utm_source=google&utm_medium=cpc&utm_campaign=sample&utm_content=sample-spec-sheet-google`,
    break_even_json: be,
    policy_check: 'Pass. Education register 4-5, Search text only, no pleasure claim, no act named, lube is inside the carve-out. Sample idea from the concept bank.',
  },
  {
    concept_slug: 'statement-reads-xdipx',
    lane: 'meta',
    register_tier: '3-4',
    title: 'The statement line, as the whole ad',
    one_liner: 'Sell the thing first-time buyers worry about: what the bank line says.',
    products: [{ handle: 'naturals-h2o-intimate-lubricant-8-5-oz', title: 'Sliquid Naturals H2O' }],
    headlines: ['Billing Reads XDIPX', 'Plain box. Plain statement.'],
    body: ['Type card on a coral-soft field. A plain box, lid closed. No product in frame.'],
    audience: { network: 'Meta', age: '25+', note: 'Health carve-out SKU only, bridge page' },
    destination_url: `${BASE}/naturals-h2o-intimate-lubricant-8-5-oz?utm_source=meta&utm_medium=paid_social&utm_campaign=sample&utm_content=sample-statement-reads-meta`,
    break_even_json: be,
    policy_check: 'Revise before any spend. Meta lane: carve-out lube SKU, no product in frame, 25+ floor, bridge page first. Needs the owner codify of the Meta lane. Discretion is courtesy, not secrecy: no "nobody will know" wording. Sample idea from the concept bank.',
  },
  {
    concept_slug: 'overheard-at-the-counter',
    lane: 'snap',
    register_tier: '6-7',
    title: 'Overheard at the counter: the plain box',
    one_liner: 'One scripted exchange, visibly ours. No chat bubbles, no phone frame.',
    products: [{ handle: 'dame-zee-bullet-vibrator-periwinkle', title: 'Dame Zee Bullet Vibrator' }],
    headlines: ['Does it come in a plain box?', 'Plainer than your mail.'],
    body: ['Kicker "At the xdipx counter". Customer line in DM Sans, the shop answers in Newsreader with one italic plum word.'],
    audience: { network: 'Snapchat', age: '18+' },
    destination_url: `${BASE}/dame-zee-bullet-vibrator-periwinkle?utm_source=snap&utm_medium=paid_social&utm_campaign=sample&utm_content=sample-overheard-snap`,
    break_even_json: be,
    policy_check: 'Pass. Snap 18+, non-graphic, register 6-7, no act named, no nudity, no implied real customer. Sample idea from the concept bank.',
  },
  {
    concept_slug: 'sculpture-hall',
    lane: 'adult',
    register_tier: '9',
    title: 'Le Wand Petite as a gallery object',
    one_liner: 'Macro on plum-soft, hard light, the shadow as a second form. The cord is the argument.',
    products: [{ handle: 'le-wand-powerful-petite-plug-in-white', title: 'Le Wand Petite Plug-In' }],
    headlines: ['Corded, so your orgasm never waits on a battery.', 'Le Wand Petite: plug it in and forget the charger.'],
    body: ['Banner set 300x250, 728x90, 300x100. Reveal frame names the product.'],
    audience: { network: 'ExoClick', note: 'site targeting, frequency cap 3' },
    destination_url: `${BASE}/le-wand-powerful-petite-plug-in-white?utm_source=exoclick&utm_medium=display&utm_campaign=sample&utm_content=sample-sculpture-adult`,
    break_even_json: be,
    policy_check: 'Pass at 9. Adult network, no nudity under the xdipx definition, product named in the reveal. Register 10 is pending codify, so this holds at 9. Sample idea from the concept bank.',
  },
  {
    concept_slug: 'second-spring',
    lane: 'newsletter',
    register_tier: '7-9',
    title: 'Steele Balls turn errands into reps',
    one_liner: 'Pelvic floor weights for midlife readers, sincere register, no medical claim beyond the label.',
    products: [{ handle: 'sportsheets-sex-mischief-steele-balls-stainless-steel', title: 'Sportsheets Steele Balls' }],
    headlines: ['Steele Balls turn errands into reps.', 'Pelvic Floor Training Weights'],
    body: ['Sponsored read, 45 seconds. Promo code plus UTM. Hand and product, warm light, no body.'],
    audience: { network: 'Newsletter sponsorship', note: 'midlife and relationships readers' },
    destination_url: `${BASE}/sportsheets-sex-mischief-steele-balls-stainless-steel?utm_source=newsletter-sample&utm_medium=sponsorship&utm_campaign=sample&utm_content=sample-second-spring-newsletter`,
    break_even_json: be,
    policy_check: 'Pass. Per-publisher norms 7-9, sincere register, no efficacy claim beyond the label ("relieves" and "restores" stay out). Sample idea from the concept bank.',
  },
  {
    concept_slug: 'for-him-plainly',
    lane: 'owned',
    register_tier: '9',
    title: 'Zing, both hands free',
    one_liner: 'A men\'s toy written and shot with the same confidence as the rest of the shelf.',
    products: [{ handle: 'arcwave-zing', title: 'Arcwave Zing' }],
    headlines: ['Zing: both hands free, nothing left to do but finish.', 'Men\'s toys, shelved next to everyone else\'s.'],
    body: ['Email header: the Zing in a hand against a bare forearm. Follow-up frame per the bodyscape rules.'],
    audience: { channel: 'Klaviyo browse abandonment', segment: 'viewed a stroker, no order' },
    destination_url: `${BASE}/arcwave-zing?utm_source=klaviyo&utm_medium=email&utm_campaign=sample&utm_content=sample-for-him-owned`,
    break_even_json: be,
    policy_check: 'Pass. Owned channel at register 9, opted-in list only, the product never rests against genitalia in frame. Sample idea from the concept bank.',
  },
]

async function main() {
  const inputs: NewIdeaInput[] = raw.map((r, i) => validateIdea(r, i))
  const fresh: NewIdeaInput[] = []
  for (const i of inputs) {
    const existing = await db
      .select({ id: adIdeas.id })
      .from(adIdeas)
      .where(and(eq(adIdeas.conceptSlug, i.conceptSlug), eq(adIdeas.lane, i.lane), eq(adIdeas.title, i.title), isNull(adIdeas.runId)))
      .limit(1)
    if (existing.length === 0) fresh.push(i)
  }
  if (fresh.length === 0) {
    console.log('All six sample ideas already exist. Nothing to do.')
    return
  }
  const rows = await createIdeas(fresh)
  console.log(`Inserted ${rows.length} sample ideas: ${rows.map(r => `#${r.id} ${r.conceptSlug}/${r.lane}`).join(', ')}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
