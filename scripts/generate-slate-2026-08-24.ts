/**
 * One-off: render the six week-1 slate frames from docs/store-team/social-slate-2026-08-24.md
 * so the owner can see them. Uses the production cast composite path (Atlas seedream edit,
 * fal fallback), rehosts to Shopify Files like a routine run, and saves local copies.
 *
 *   npx tsx scripts/generate-slate-2026-08-24.ts --out <dir> [--only 1,3] [--count 1]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env' }); loadEnv({ path: '.env.local' })

const DAYLIGHT = 'Bright natural daylight, window light, door open to a sunlit room, open detailed shadows, warm white paper and coral-soft plaster tones. Photoreal editorial campaign photography, 4:5 portrait, no text, no logos, no packaging, no retail carton.'
const FENCE = 'Nipples covered by fabric, a hand or an arm. No visible labia, no visible genitals, no sheer fabric over nipples or groin. Adults in their late 20s to mid 30s.'

interface Slot { n: number; handle: string; cast: string[]; mood: string; prompt: string; scaleIn?: number; extraProduct?: string; productImageIndex?: number }
const SLOTS: Slot[] = [
  { n: 1, handle: 'womanizer-next-sage', cast: ['jade', 'maya'], mood: 'gap-kitchen-morning', scaleIn: 6,
    prompt: 'Two women side by side leaning on a sunlit kitchen counter in late morning. The first woman (reference 1) wears an oversized white men\'s shirt unbuttoned to the navel, breasts visible to the edge of the areola with the shirt edges covering the nipples, a black thong, bare legs and bare buttocks where she leans on the counter; she reads her phone with a shocked disbelieving expression, eyebrows raised, mouth slightly open. The second woman (reference 2) wears an opaque grey cotton bralette (nipples completely hidden) and high-cut black briefs, pubic mound visible above the waistband; she holds the product (the exact product in the product reference) up at chest height between them with a knowing half smile. SCALE IS CRITICAL: the product is about 6 inches long, the size of a computer mouse or a bar of soap; it fits inside her hand with only the rounded top rising above her fingers; it is NOT as long as her forearm, looking sideways at the first woman. Garden door open behind them.' },
  { n: 2, handle: 'zola-rechargeable-silicone-mini-wand', cast: ['priya'], mood: 'anyhour-balcony-2pm',
    prompt: 'A woman (reference 1) sitting in a chair on a sunny city balcony at 2pm, coffee and a laptop pushed aside. She wears a white linen shirt fully open, breasts bare with the shirt edges covering the nipples, tiny high-cut white bottoms with a little pubic hair visible above the waistband, bare legs. The product (the exact product in the product reference, at true scale, magenta) rests against the inside of her upper thigh with her fingers wrapped around it. Her head is tipped back against the chair, eyes closed, a private smile, sun on her throat.' },
  { n: 3, handle: 'womanizer-classic-2-rechargeable-silicone-pleasure-air-clitoral-stimulator', cast: ['sofia', 'diego'], mood: 'wtf-bathroom-midday', scaleIn: 6, productImageIndex: 1,
    prompt: 'A woman (reference 1) and a man (reference 2) at a bright bathroom vanity at midday, door open to a bright hallway. She wears only a white towel tied low at the waist, breasts bare with her own forearm fully covering both nipples; with her other hand she holds the product up toward the mirror, gripped firmly between her thumb and fingers around its body, the product clearly in contact with her hand and not resting on an open palm or floating. The product MUST be exactly the one in the product reference photo: a MATTE BLACK palm-sized air-pulsation stimulator, a smooth black teardrop-shaped curved body about 6 inches long with a small round black silicone nozzle low on the front and two flush buttons on the side; entirely black, no white, no rose gold, no metal trim; reproduce its shape, color and proportions faithfully and do not invent a different object so its silicone head faces the camera, with a curious puzzled frown. He is shirtless in grey shorts, bare chest and arms, standing close behind her, chin near her shoulder, eyebrows raised, looking at the product.' },
  { n: 4, handle: 'renegade-emperor-vibrating-ring', cast: ['sofia', 'marcus'], mood: 'sayit-sofa-afternoon',
    prompt: 'A woman (reference 1) sitting across the lap of a man (reference 2) on a sofa in 4pm sun through open blinds, facing him, one knee either side. She wears a black lace bralette with the nipples covered and a black thong, bare buttocks visible from the side; he is shirtless in jeans, one hand on her bare hip. Her hand places the product (the exact product in the product reference, a vibrating ring, at true scale) into his open palm. Both laughing, eye contact.' },
  { n: 5, handle: 'classique-rechargeable-wand-massager', cast: ['emma', 'jade'], mood: 'lightson-bed-11am',
    prompt: 'Two women lying across an unmade bed with white sheets in full morning sun at 11am, curtains wide open. The first woman (reference 1) lies on her back in an unbuttoned pale pink shirt, worn open over a pale pink lace bralette that fully covers both nipples, her stomach bare, a thong, bare legs; she laughs up at the ceiling. The second woman (reference 2) is propped on one elbow beside her in a plain fitted dusty-pink cotton tank top with no cutouts, holes or rips, and a thong, bare buttocks visible; she holds the product (the exact product in the product reference, a full-size wand massager at true scale) with its head resting on the first woman\'s lower stomach just above the thong line, watching her with anticipation.' },
  { n: 6, handle: 'jo-h2o-cooling-water-based-lubricant', cast: ['maya'], mood: 'nightstand-bed-noon', extraProduct: 'https://cdn.shopify.com/s/files/1/0761/6872/4651/files/58939.jpg',
    prompt: 'A woman (reference 1) kneeling sideways on a sunlit bed at noon, curtains open. She wears an opaque white cotton bralette (thick fabric, nipples completely hidden, not sheer, not lace) and a white thong, bare buttocks visible. In her left hand she holds the product (the exact product in the product reference, a lubricant bottle, at true scale); in her right hand the pink bullet vibrator shown in the last reference image (a smooth pink silicone bullet about 3.3 inches long, roughly the length of her palm from wrist crease to the base of her fingers, clearly visible and not tiny), held up clean and dry with no lubricant on it. The bottle cap is open and a single clear drop of lubricant sits on the pad of her thumb on the bottle hand. She looks from the bottle to the bullet with a small surprised smile of interest.' },
]

async function main() {
  const args = process.argv.slice(2)
  const out = args[args.indexOf('--out') + 1]
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1]!.split(',').map(Number) : null
  const count = args.includes('--count') ? Number(args[args.indexOf('--count') + 1]) : 1
  if (!out) throw new Error('--out required')
  mkdirSync(out, { recursive: true })

  const { getApprovedCastMembers } = await import('../app/lib/sanity.server')
  const { getProductByHandle } = await import('../app/lib/shopify.server')
  const { generateCastComposite, lengthInchesFromSpecifications, scaleCueFromLengthInches } = await import('../app/lib/social-media.server')

  const cast = await getApprovedCastMembers()
  const byslug = Object.fromEntries(cast.map(c => [c.slug.toLowerCase(), c]))
  console.log('cast:', Object.keys(byslug).join(','))
  const date = '20260822'
  const results: Record<string, unknown>[] = []

  for (const s of SLOTS) {
    if (only && !only.includes(s.n)) continue
    const product = await getProductByHandle(s.handle)
    if (!product) { console.error(`slot ${s.n}: product ${s.handle} not found`); continue }
    const productImageUrl = product.images?.[s.productImageIndex ?? 0]?.url ?? product.images?.[0]?.url
    if (!productImageUrl) { console.error(`slot ${s.n}: no product image`); continue }
    const refs = s.cast.map(c => byslug[c]?.photoUrl).filter(Boolean) as string[]
    if (refs.length !== s.cast.length) { console.error(`slot ${s.n}: missing cast ref for ${s.cast.join(',')}`); continue }
    const specs = (product as unknown as { specifications?: string[] }).specifications
    const inches = lengthInchesFromSpecifications(specs) ?? s.scaleIn ?? null
    const scale = inches ? scaleCueFromLengthInches(inches) : 'true to the product reference photo'
    const prompt = `${s.prompt} ${DAYLIGHT} ${FENCE}`
    console.log(`\nslot ${s.n} ${s.handle} cast=${s.cast.join('+')} inches=${inches ?? '?'}`)
    try {
      const r = await generateCastComposite({
        prompt, handle: s.handle, mood: s.mood, date,
        presenterImageUrl: refs[0]!, productImageUrl, scale,
        ...((refs.length > 1 || s.extraProduct) ? { extraImageUrls: [...refs.slice(1), ...(s.extraProduct ? [s.extraProduct] : [])] } : {}),
        count, aspectRatio: '4:5', caller: 'owner-slate-preview',
      })
      for (const [i, url] of r.urls.entries()) {
        const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
        const file = join(out, `slot${s.n}-${i + 1}.jpg`)
        writeFileSync(file, buf)
        console.log('  saved', file, url)
      }
      results.push({ slot: s.n, urls: r.urls, costs: r.costs })
    } catch (err) {
      console.error(`  slot ${s.n} FAILED:`, (err as Error).message)
      results.push({ slot: s.n, error: (err as Error).message })
    }
  }
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2))
}
main().catch(e => { console.error(e); process.exit(1) })
