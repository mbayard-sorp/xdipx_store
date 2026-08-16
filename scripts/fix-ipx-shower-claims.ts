/**
 * Ticket #1006: live PDP copy for adam-eve-wanda-lust-powerful-wand-massager
 * (IPX4, magnetic charging contacts exposed) claims its splashproof seal
 * "opens up the shower". IPX4/5/6 mean splash or jet resistance, not shower
 * or submersion safety, and this SKU charges over exposed magnetic
 * contacts, a real water-ingress failure mode, and the same PDP separately
 * warns not to submerge it, so the shower claim is internally contradictory.
 *
 * Per the ticket, this is a systematic enrichment pattern, not a one-off.
 * scripts/audit results (2026-08-15) found 24 ACTIVE products rated
 * IPX4/IPX5/IPX6 whose stored copy (descriptionHtml, full_story,
 * feature_bullets, seo_meta_description, or specifications) claims shower,
 * bath, or submersion safety. Every entry below is a hand-verified,
 * minimal, literal replacement, not a generated rewrite: only the water-
 * safety claim changes, nothing else about voice, structure, or other facts.
 *
 * Each replacement is applied with an exact-match check against the current
 * live value; if the text has drifted since this was written, that product
 * is skipped and reported rather than silently mismatched.
 *
 * Usage:
 *   npx tsx scripts/fix-ipx-shower-claims.ts             # dry run
 *   npx tsx scripts/fix-ipx-shower-claims.ts --apply     # writes to Shopify (+ Sanity mirror)
 */
import './_load-env'
import { adminGraphQL, shopifyAdmin, updateProductDescriptionHtml, updateProductMetafield } from '~/lib/shopify.server'
import { upsertProductPage } from '~/lib/sanity.server'

const APPLY = process.argv.includes('--apply')

type Field = 'descriptionHtml' | 'full_story' | 'feature_bullets' | 'seo_meta_description' | 'specifications'

interface Repl {
  handle: string
  field: Field
  old: string
  new: string
}

const REPLACEMENTS: Repl[] = [
  // 1. curve-toys-gossip-pop-rocker (IPX5)
  { handle: 'curve-toys-gossip-pop-rocker-rechargeable-remote-controlled-silicone-vibrating-anal-plug-magenta', field: 'full_story',
    old: '<li>Waterproof design for shower shenanigans and easy cleanup</li>',
    new: '<li>Splashproof design (IPX5) makes cleanup easy at the sink, but skip the shower and never submerge it</li>' },
  { handle: 'curve-toys-gossip-pop-rocker-rechargeable-remote-controlled-silicone-vibrating-anal-plug-magenta', field: 'feature_bullets',
    old: 'Waterproof design lets you take the fun anywhere — from the bedroom to the bath',
    new: 'Splashproof design (IPX5) handles sink splashes and quick cleanup, but keep it out of the bath and never submerge it' },

  // 2. solace-thrusting-masturbator (IPX4)
  { handle: 'solace-thrusting-masturbator', field: 'feature_bullets',
    old: 'IPX4 waterproof design means easy cleanup and shower-friendly adventures — because aftercare should be effortless',
    new: "IPX4 splash-resistant design means easy rinse-off cleanup at the sink, though it's not shower-safe, because aftercare should still be effortless" },

  // 3. lickgasm-kissing-vibrating-rose (IPX6)
  { handle: 'lickgasm-kissing-vibrating-rose-clitoral-stimulator-swirl', field: 'full_story',
    old: '<li><strong>Shower-friendly fun:</strong> IPX6 waterproof rating means steamy sessions just got steamier</li>',
    new: '<li><strong>Splash-ready:</strong> IPX6 rating handles splashes and sink cleanup, but skip the shower and never submerge it</li>' },
  { handle: 'lickgasm-kissing-vibrating-rose-clitoral-stimulator-swirl', field: 'feature_bullets',
    old: "IPX6 waterproof design transforms shower time into playtime (just don't fully submerge)",
    new: "IPX6 rating makes it splash-resistant and easy to rinse clean at the sink, but it's not shower-safe, so keep it dry there" },

  // 4. finger-wag (IPX6)
  { handle: 'finger-wag', field: 'full_story',
    old: 'and the splashproof design means your shower time just got a whole lot more interesting.',
    new: "and the splashproof (IPX6) design makes rinsing it clean at the sink effortless, though it's not built for the shower." },
  { handle: 'finger-wag', field: 'full_story',
    old: '<li><strong>Splashproof design</strong> — shower thoughts just got steamier</li>',
    new: '<li><strong>Splashproof design</strong> — easy sink cleanup, but keep it out of the shower</li>' },
  { handle: 'finger-wag', field: 'feature_bullets',
    old: 'Splashproof design turns shower time into playtime',
    new: "Splashproof (IPX6) design makes sink cleanup effortless, though it's not rated for the shower" },

  // 5. pep-talk (IPX6)
  { handle: 'pep-talk', field: 'full_story',
    old: '<li>Waterproof design for shower pep talks <em>(because why not?)</em></li>',
    new: '<li>Splashproof design (IPX6) for easy sink cleanup, though showers are off the table <em>(save the pep talk for dry land)</em></li>' },
  { handle: 'pep-talk', field: 'feature_bullets',
    old: 'Shower-safe waterproof design means your pep talk can happen anywhere you need encouragement',
    new: "Splash-resistant IPX6 design means quick sink cleanup, though the shower isn't where this pep talk happens" },

  // 6. nora-bluetooth-remote-controlled (IPX6)
  { handle: 'nora-bluetooth-remote-controlled-long-distance-rabbit-vibrator', field: 'full_story',
    old: '<li>Splashproof design means bath time just got infinitely more interesting</li>',
    new: '<li>Splashproof design (IPX6) handles splashes and easy cleanup, but bath time is off the table, never submerge it</li>' },

  // 7. classique-rechargeable-wand-massager / Le Wand Classique (IPX6)
  { handle: 'classique-rechargeable-wand-massager', field: 'feature_bullets',
    old: 'IPX6 splash-proof design lets you explore relaxation in the bath or shower',
    new: 'IPX6 splash-proof design makes cleanup at the sink effortless, though the bath and shower are off the table' },

  // 8. we-vibe-sync-lite-pink (IPX4)
  { handle: 'we-vibe-sync-lite-pink', field: 'full_story',
    old: '<li>Splashproof design for adventurous bath time or easy cleanup</li>',
    new: '<li>Splashproof design (IPX4) for easy cleanup at the sink, skip the bath and never submerge it</li>' },
  { handle: 'we-vibe-sync-lite-pink', field: 'feature_bullets',
    old: '45 minutes of play time plus splash-proof design for shower fun',
    new: "45 minutes of play time plus splash-proof design (IPX4) for easy cleanup, though it's not shower-safe" },

  // 9. nuud-rose-pulsing-vibrator (IPX6)
  { handle: 'nuud-rose-pulsing-vibrator', field: 'full_story',
    old: 'plus waterproof design for those spontaneous shower serenades, it\'s basically the overachiever of the pleasure garden.',
    new: "plus a splashproof (IPX6) design built for easy cleanup, not the shower, it's basically the overachiever of the pleasure garden." },
  { handle: 'nuud-rose-pulsing-vibrator', field: 'full_story',
    old: '<li><strong>IPX6 waterproof</strong> — bathtub adventures are officially approved</li>',
    new: '<li><strong>IPX6 splashproof</strong> — sink cleanup is officially approved, bathtub adventures are not</li>' },
  { handle: 'nuud-rose-pulsing-vibrator', field: 'feature_bullets',
    old: 'IPX6 waterproof design for easy cleanup and adventurous bath time fun',
    new: 'IPX6 splashproof design for easy cleanup, though bath time is off the table' },

  // 10. jock-28x-vibrating-silicone-balls-large (IPX5)
  { handle: 'jock-28x-vibrating-silicone-balls-large', field: 'full_story',
    old: "Waterproof and ready for adventure, these premium silicone beauties don't discriminate",
    new: "Splash-resistant (IPX5) and ready for easy cleanup, these premium silicone beauties don't discriminate" },
  { handle: 'jock-28x-vibrating-silicone-balls-large', field: 'full_story',
    old: '<li>Waterproof design means bath time just got infinitely more interesting</li>',
    new: '<li>Splash-resistant design (IPX5) makes cleanup easy, though bath time is off the table</li>' },

  // 11. le-wand-mini-micro-wand (IPX5)
  { handle: 'le-wand-mini-micro-wand', field: 'descriptionHtml',
    old: 'That IPX5 rating makes it shower-ready, which opens up a few obvious possibilities.',
    new: "That IPX5 rating makes it splash-resistant for easy cleanup at the sink, though it's not built for the shower." },
  { handle: 'le-wand-mini-micro-wand', field: 'seo_meta_description',
    old: 'Whisper quiet, shower safe. Ships discreet.',
    new: 'Whisper quiet, splash-resistant. Ships discreet.' },
  { handle: 'le-wand-mini-micro-wand', field: 'specifications',
    old: '<strong>Water resistance:</strong> IPX5 shower friendly',
    new: '<strong>Water resistance:</strong> IPX5, splash-resistant (not shower-safe)' },

  // 12. romp-jiggle (IPX6)
  { handle: 'romp-jiggle', field: 'descriptionHtml',
    old: 'The suction cup is genuinely powerful, rated for hard, smooth surfaces including shower walls, and the thrusting motion is designed to feel far more realistic than most toys at this price point.',
    new: "The suction cup is genuinely powerful and grips hard, smooth surfaces well, though the IPX6 rating means it's splash-resistant, not shower-safe, so keep it out of a running shower. The thrusting motion is designed to feel far more realistic than most toys at this price point." },
  { handle: 'romp-jiggle', field: 'specifications',
    old: '<strong>Water Resistance:</strong> IPX6 splashproof for shower play',
    new: '<strong>Water Resistance:</strong> IPX6, splash-resistant (not shower-safe)' },

  // 13. rumblers-10x-rabbit-silicone-vibrator (IPX6)
  { handle: 'rumblers-10x-rabbit-silicone-vibrator', field: 'seo_meta_description',
    old: 'Hot pink rabbit vibrator with 5 speeds, 5 patterns of rumbly vibration, plus waterproof design for shower play. XDIPX.',
    new: 'Hot pink rabbit vibrator with 5 speeds, 5 patterns of rumbly vibration, plus a splash-resistant design for easy cleanup. XDIPX.' },

  // 14. bloomgasm-pleasure-10x-silicone-wand (IPX6)
  { handle: 'bloomgasm-pleasure-10x-silicone-wand-with-attachment', field: 'descriptionHtml',
    old: 'The waterproof rating means shower play is genuinely on the table, and the rechargeable battery keeps up with whatever mood strikes.',
    new: "The IPX6 rating means it's splash-resistant for easy cleanup, though the shower isn't on the table, and the rechargeable battery keeps up with whatever mood strikes." },

  // 15. le-wand-mini-vibe-g-double (IPX6)
  { handle: 'le-wand-mini-vibe-g-double', field: 'descriptionHtml',
    old: 'The magnetic charging port is genius for travel, and the splash-proof rating means shower adventures are totally on the table.',
    new: 'The magnetic charging port is genius for travel, and the IPX6 splash-proof rating keeps cleanup easy, though shower adventures aren\'t on the table.' },

  // 16. honey-play-box-tickler (IPX6)
  { handle: 'honey-play-box-tickler-wiggling-g-spot-vibrator-tapping-clitoral-stimulator', field: 'descriptionHtml',
    old: 'The silicone feels luxurious and the waterproof rating means shower adventures are on the table.',
    new: "The silicone feels luxurious and the IPX6 rating means it's splash-resistant for easy cleanup, though shower adventures aren't on the table." },
  { handle: 'honey-play-box-tickler-wiggling-g-spot-vibrator-tapping-clitoral-stimulator', field: 'specifications',
    old: 'Waterproof: IPX6 rated for shower play',
    new: 'Waterproof: IPX6, splash-resistant (not shower-safe)' },

  // 17. doxy-die-cast-compact-cordless-wand-black (IPX4)
  { handle: 'doxy-die-cast-compact-cordless-wand-black', field: 'descriptionHtml',
    old: 'IPX4-rated for shower use, USB-C charged, and topping out around 70dB, it runs quiet enough for most rooms.',
    new: 'IPX4-rated for splash resistance (not shower use), USB-C charged, and topping out around 70dB, it runs quiet enough for most rooms.' },
  { handle: 'doxy-die-cast-compact-cordless-wand-black', field: 'seo_meta_description',
    old: 'Redesigned head, 8 speeds, IPX4 shower-safe, USB-C charging. Ships discreet. xdipx.com.',
    new: 'Redesigned head, 8 speeds, IPX4 splash-resistant, USB-C charging. Ships discreet. xdipx.com.' },
  { handle: 'doxy-die-cast-compact-cordless-wand-black', field: 'specifications',
    old: 'Water resistance: IPX4 showerproof',
    new: 'Water resistance: IPX4, splash-resistant (not shower-safe)' },

  // 18. le-wand-mini-micro-wand-violet (IPX5)
  { handle: 'le-wand-mini-micro-wand-violet', field: 'descriptionHtml',
    old: '<em>Shower-friendly and USB rechargeable</em>, it suits anyone who wants reliable, travel-ready power without carrying something the size of a hairdryer home.',
    new: '<em>Splash-resistant and USB rechargeable</em>, it suits anyone who wants reliable, travel-ready power without carrying something the size of a hairdryer home.' },
  { handle: 'le-wand-mini-micro-wand-violet', field: 'seo_meta_description',
    old: 'Shower-friendly, USB rechargeable, travel-ready. Ships discreet. xdipx.com.',
    new: 'Splash-resistant, USB rechargeable, travel-ready. Ships discreet. xdipx.com.' },
  { handle: 'le-wand-mini-micro-wand-violet', field: 'specifications',
    old: 'Water resistance: IPX5 shower friendly',
    new: 'Water resistance: IPX5, splash-resistant (not shower-safe)' },

  // 19. adam-eve-lilac-love-wand (IPX6)
  { handle: 'adam-eve-lilac-love-wand', field: 'descriptionHtml',
    old: '<strong>Body-safe silicone, splashproof to IPX6</strong>, and USB rechargeable, it goes wherever the evening takes you, including the shower.',
    new: '<strong>Body-safe silicone, splashproof to IPX6</strong>, and USB rechargeable, it goes wherever the evening takes you, sink splashes included, just not the shower.' },
  { handle: 'adam-eve-lilac-love-wand', field: 'seo_meta_description',
    old: 'Precise vibration, shower-ready, USB rechargeable. Ships discreet. xdipx.com.',
    new: 'Precise vibration, splash-resistant, USB rechargeable. Ships discreet. xdipx.com.' },

  // 20. adam-eve-lilac-licks (IPX5)
  { handle: 'adam-eve-lilac-licks', field: 'descriptionHtml',
    old: 'Waterproof enough for the shower; strong enough to be the main event.',
    new: 'Splashproof enough for easy cleanup, not the shower; strong enough to be the main event.' },

  // 21. adam-eve-wanda-lust-powerful-wand-massager (IPX4) — the named ticket item.
  // Matches the corrected line content already drafted, per ticket #1006.
  { handle: 'adam-eve-wanda-lust-powerful-wand-massager', field: 'descriptionHtml',
    old: 'Its splashproof seal opens up the shower, and the magnetic charge keeps it ready without a drawer full of tangled cables.',
    new: 'Splashproof at IPX4, so it shrugs off splashes at the sink or a wet hand, but keep it out of the shower and never submerge it. The magnetic charge keeps it ready without a drawer full of tangled cables.' },

  // 22. adam-eve-bendy-bitty-wand (IPX6)
  { handle: 'adam-eve-bendy-bitty-wand', field: 'descriptionHtml',
    old: 'the splashproof build means it handles shower sessions without a second thought.',
    new: 'the splashproof build means it handles sink splashes without a second thought, though the shower is off the table.' },

  // 23. adam-eve-waving-wabbit (IPX6)
  { handle: 'adam-eve-waving-wabbit', field: 'descriptionHtml',
    old: '<strong>Splashproof and glow-button guided</strong>, it transitions from bedroom to shower without a second thought.',
    new: '<strong>Splashproof and glow-button guided</strong>, it handles sink cleanup without a second thought, just not the shower.' },

  // 24. romp-riot-rechargeable-bullet-vibrator-light-orange (IPX5)
  { handle: 'romp-riot-rechargeable-bullet-vibrator-light-orange', field: 'descriptionHtml',
    old: 'The silicone tip keeps things body-safe and easy to clean, and the splashproof rating means the shower is an option too.',
    new: "The silicone tip keeps things body-safe and easy to clean, and the splashproof (IPX5) rating means quick rinses are fine, though the shower isn't." },
]

console.log(`${REPLACEMENTS.length} replacements across ${new Set(REPLACEMENTS.map(r => r.handle)).size} products`)

// Verified against live Admin metafield types per field (specifications is
// legacy multi_line_text_field on every sampled product, not json, despite
// scripts/shopify-metafield-defs.ts describing it as json for new writes).
const METAFIELD_TYPES: Record<Exclude<Field, 'descriptionHtml'>, string> = {
  full_story: 'multi_line_text_field',
  feature_bullets: 'json',
  seo_meta_description: 'multi_line_text_field',
  specifications: 'multi_line_text_field',
}

interface GqlProduct {
  legacyResourceId: string
  title: string
  handle: string
  descriptionHtml: string | null
  metafields: { nodes: { key: string; value: string }[] }
}

const byHandle = new Map<string, Repl[]>()
for (const r of REPLACEMENTS) {
  if (!byHandle.has(r.handle)) byHandle.set(r.handle, [])
  byHandle.get(r.handle)!.push(r)
}

let lastRestCallAt = 0
async function restGate(): Promise<void> {
  const minGapMs = 560
  const wait = lastRestCallAt + minGapMs - Date.now()
  if (wait > 0) await new Promise(res => setTimeout(res, wait))
  lastRestCallAt = Date.now()
}

let totalFieldChanges = 0
let notFoundCount = 0
let appliedProducts = 0

for (const [handle, repls] of byHandle) {
  const data: { products: { nodes: GqlProduct[] } } = await adminGraphQL(`
    query { products(first: 1, query: "handle:${handle}") {
      nodes { legacyResourceId title handle descriptionHtml metafields(namespace: "xdipx", first: 30) { nodes { key value } } }
    } }`)
  const p = data.products.nodes[0]
  if (!p) {
    console.error(`SKIP ${handle}: product not found (handle may have changed)`)
    continue
  }

  const currentByField = new Map<Field, string>()
  currentByField.set('descriptionHtml', p.descriptionHtml ?? '')
  for (const m of p.metafields.nodes) {
    if (['full_story', 'feature_bullets', 'seo_meta_description', 'specifications'].includes(m.key)) {
      currentByField.set(m.key as Field, m.value)
    }
  }

  const fieldGroups = new Map<Field, Repl[]>()
  for (const r of repls) {
    if (!fieldGroups.has(r.field)) fieldGroups.set(r.field, [])
    fieldGroups.get(r.field)!.push(r)
  }

  const writes: { field: Field; text: string }[] = []
  for (const [field, group] of fieldGroups) {
    let current = currentByField.get(field)
    if (current === undefined) {
      console.error(`SKIP ${handle} ${field}: field not present on product`)
      notFoundCount += group.length
      continue
    }
    let changedHere = false
    for (const r of group) {
      if (!current.includes(r.old)) {
        console.error(`NOT FOUND ${handle} ${field}: old text has drifted, skipping this replacement\n  expected: ${r.old}`)
        notFoundCount++
        continue
      }
      current = current.replace(r.old, r.new)
      changedHere = true
      totalFieldChanges++
    }
    if (changedHere) {
      if (field === 'feature_bullets') {
        try { JSON.parse(current) } catch {
          console.error(`ABORT ${handle} ${field}: replacement produced invalid JSON, not writing`)
          continue
        }
      }
      writes.push({ field, text: current })
    }
  }

  if (!writes.length) continue

  console.log(`\n[${handle}] ${p.title}`)
  for (const w of writes) console.log(`  ${w.field}:\n    ${w.text}`)

  if (!APPLY) continue

  async function writeField(w: { field: Field; text: string }, attempts = 5): Promise<boolean> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await restGate()
        if (w.field === 'descriptionHtml') {
          await updateProductDescriptionHtml(`gid://shopify/Product/${p!.legacyResourceId}`, w.text)
        } else {
          await updateProductMetafield(`gid://shopify/Product/${p!.legacyResourceId}`, w.field, w.text, METAFIELD_TYPES[w.field])
        }
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`  write attempt ${attempt} failed ${handle} ${w.field}: ${msg}`)
        await new Promise(res => setTimeout(res, msg.includes('429') ? 2500 : attempt * 1000))
      }
    }
    console.error(`  WRITE FAILED (all retries exhausted) ${handle} ${w.field}`)
    return false
  }

  for (const w of writes) {
    await writeField(w)
  }

  // Mirror descriptionHtml/seo_meta_description to Sanity — confirmed by the
  // #3010 fix that api/sanity-product-push.tsx re-pushes description and
  // seoDescription to Shopify on Sanity publish, which would otherwise
  // revert this fix on the next unrelated Sanity edit. full_story,
  // feature_bullets, and specifications are not in that push-back payload
  // (verified against app/routes/api.sanity-product-push.tsx), so no mirror
  // needed for those.
  const descWrite = writes.find(w => w.field === 'descriptionHtml')
  const seoWrite = writes.find(w => w.field === 'seo_meta_description')
  if (descWrite || seoWrite) {
    try {
      await upsertProductPage({
        handle: p.handle,
        shopifyProductId: `gid://shopify/Product/${p.legacyResourceId}`,
        title: p.title,
        ...(descWrite ? { description: descWrite.text } : {}),
        ...(seoWrite ? { seoDescription: seoWrite.text } : {}),
      })
    } catch (err) {
      console.error(`  Sanity mirror failed for ${handle}: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Read-back confirmation for the safety-relevant field. Never let this
  // crash the batch — a failed check here just gets reported and picked up
  // by the next (idempotent) run.
  if (descWrite) {
    try {
      await restGate()
      const check = await shopifyAdmin<{ product: { body_html: string } }>(`/products/${p.legacyResourceId}.json`)
      if (check.product.body_html !== descWrite.text) {
        console.error(`  WARNING: ${handle} descriptionHtml did not persist on read-back`)
      }
    } catch (err) {
      console.error(`  read-back check failed for ${handle}: ${err instanceof Error ? err.message : err}`)
    }
  }

  appliedProducts++
}

console.log(`\n${APPLY ? 'applied' : '[dry-run] would apply'} to ${appliedProducts} product(s), ${totalFieldChanges} field replacement(s) matched, ${notFoundCount} not found (drift)`)
process.exit(0)
