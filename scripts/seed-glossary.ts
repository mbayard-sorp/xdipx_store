/**
 * scripts/seed-glossary.ts
 *
 * Seed the Notebook glossary (/notebook/glossary) with its 20 starter terms.
 * Definitions were drafted by emma-copywriter and gated by
 * emma-empathy-reviewer; edit them in Studio afterward, not here.
 *
 * Idempotent: deterministic _ids (`blogGlossaryTerm.<slug>`), createOrReplace
 * in one transaction, with seeAlso references wired in a second pass (so a
 * term can reference one seeded later in the list). Re-running restores the
 * starter set; terms added in Studio with other slugs are untouched.
 *
 *   npx tsx scripts/seed-glossary.ts [--dry-run]
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

const dryRun = process.argv.includes('--dry-run')

const client = createClient({ projectId, dataset, apiVersion: '2024-10-01', useCdn: false, token })

interface TermSeed {
  term: string
  slug: string
  definition: string
  collectionHandle: string | null
  seeAlso: string[]
}

const TERMS: TermSeed[] = [
  {
    term: 'Air pulsation',
    slug: 'air-pulsation',
    definition: "Air pulsation is a stimulation method that uses rhythmic changes in air pressure inside a small chamber to create suction and pulse sensations around the clitoris, without direct contact or penetration. The toy seals lightly over the area and cycles pressure waves instead of vibrating against skin. This makes the sensation feel more internal and diffuse than standard vibration, and some people find it gentler than direct vibration if that feels too intense. Look for adjustable intensity levels and a soft, flexible seal that fits different anatomies comfortably.",
    collectionHandle: 'air-pulse-suction',
    seeAlso: ['clitoral-stimulation', 'bullet-vibrator'],
  },
  {
    term: 'Wand massager',
    slug: 'wand-massager',
    definition: "A wand massager is a large-headed vibrator built for broad, powerful external stimulation, originally designed for muscle massage and adapted for sexual pleasure. Its wide, rounded head spreads vibration across more surface area than a bullet or standard vibrator, making it useful for clitoral stimulation, shoulders, or back tension alike. Wands are typically corded or have long battery life, since strong motors draw more power. Cordless models trade some intensity for portability, so check the spec sheet if raw power matters most.",
    collectionHandle: 'wands',
    seeAlso: ['clitoral-stimulation', 'app-controlled-toy'],
  },
  {
    term: 'Bullet vibrator',
    slug: 'bullet-vibrator',
    definition: "A bullet vibrator is a small, egg- or bullet-shaped vibrator meant for precise, targeted stimulation rather than broad coverage. Its compact size makes it easy to angle exactly where it's wanted, whether that's the clitoris, nipples, or other sensitive spots, and it's a common first toy because it's discreet and simple to use. Many are wireless and rechargeable, and some are designed to tuck into underwear for hands-free or partnered play. Motor strength varies a lot at this size, so reviews on intensity are worth reading before buying.",
    collectionHandle: 'bullets-eggs',
    seeAlso: ['clitoral-stimulation', 'remote-control-toy'],
  },
  {
    term: 'Rabbit vibrator',
    slug: 'rabbit-vibrator',
    definition: "A rabbit vibrator combines an internal shaft for vaginal penetration with a second arm or attachment, often shaped like rabbit ears, that stimulates the clitoris at the same time. The two motors usually run independently, so intensity and pattern can be tuned separately for each. This dual-stimulation design is aimed at reaching combined internal and external orgasm in one toy rather than switching between two. Shaft flexibility and the angle of the clitoral arm vary by model, so fit is worth checking against personal anatomy.",
    collectionHandle: 'rabbits',
    seeAlso: ['g-spot', 'clitoral-stimulation'],
  },
  {
    term: 'G-spot',
    slug: 'g-spot',
    definition: "The G-spot refers to an area a few inches inside the front vaginal wall, near the urethral sponge, that many people find especially responsive to firm, curved pressure. It isn't a separate organ, it's a zone of nerve-dense tissue that responds differently than the vaginal opening or cervix to stimulation. Toys designed for G-spot stimulation typically have a pronounced upward curve or a bulbed tip to apply consistent pressure there during penetration. Not everyone locates or responds to it the same way, and that's normal, sensitivity and location both vary from person to person.",
    collectionHandle: 'dildos',
    seeAlso: ['rabbit-vibrator', 'clitoral-stimulation'],
  },
  {
    term: 'Clitoral stimulation',
    slug: 'clitoral-stimulation',
    definition: "Clitoral stimulation means direct or indirect touch, pressure, vibration, or suction applied to the clitoris, the small, nerve-dense organ at the front of the vulva that's the primary source of orgasm for most people with vulvas. The visible part is only the tip of a larger internal structure, which is why pressure and angle can matter as much as raw vibration strength. Toys built for this purpose range from small precision vibrators to air-pulsation devices to the clitoral arms on rabbit-style toys. Sensitivity differs widely from person to person, so adjustable intensity settings are worth prioritizing, especially for anyone new to the sensation.",
    collectionHandle: 'vibrators',
    seeAlso: ['bullet-vibrator', 'air-pulsation'],
  },
  {
    term: 'Prostate massager',
    slug: 'prostate-massager',
    definition: "A prostate massager is a toy shaped to reach the prostate gland through the front wall of the rectum, usually with a curved or angled tip and a flared base for safe removal. The prostate is a source of intense pleasure for people who have one, sometimes described as a distinct kind of orgasm separate from ejaculation. Many models add vibration on top of the curved shape, and some include a perineum arm that presses from outside at the same time. Anal insertion always calls for lube and a slow, unhurried pace, regardless of the toy.",
    collectionHandle: 'prostate-toys',
    seeAlso: ['butt-plug', 'anal-beads'],
  },
  {
    term: 'Kegel exerciser',
    slug: 'kegel-exerciser',
    definition: "A kegel exerciser, sometimes called a kegel ball or weighted vaginal ball, is a small weighted device inserted vaginally to give the pelvic floor muscles something to engage against, similar to resistance training for any other muscle group. Regularly contracting around the weight can build pelvic floor tone over time, which some people pursue for general wellness or as a complement to physical therapy guidance. Sets often include balls of increasing weight so intensity can be raised gradually. This is a wellness tool, not a medical treatment, so anyone with a specific pelvic floor condition should check with a healthcare provider on what's appropriate.",
    collectionHandle: 'wellness',
    seeAlso: ['body-safe-materials'],
  },
  {
    term: 'Cock ring',
    slug: 'cock-ring',
    definition: "A cock ring is a stretchy or rigid ring worn at the base of the penis, and sometimes around the testicles too, that restricts blood outflow to help maintain firmness and can intensify or delay orgasm. Stretchable silicone or elastomer rings adjust to fit and are easiest for beginners, while rigid metal rings offer a firmer squeeze but need to be sized carefully since they can't stretch. Many now include a small vibrating bullet built into the ring for added stimulation to a partner or to the wearer. A ring should never be worn for more than about 20 to 30 minutes at a time, and it should come off immediately if numbness or discoloration occurs.",
    collectionHandle: 'cock-rings',
    seeAlso: ['stroker', 'body-safe-materials'],
  },
  {
    term: 'Stroker',
    slug: 'stroker',
    definition: "A stroker is a masturbation sleeve for the penis, typically a soft inner canal housed inside a firmer outer shell that the hand grips and moves along the shaft. Textures on the inner canal, from ribbed to nubbed to smooth, change the sensation, and some strokers add suction, vibration, or automated stroking motion. Open-ended designs are easier to clean, while closed-ended ones build more suction pressure. Whatever the design, checking that the inner material is body-safe and washable matters as much as the texture.",
    collectionHandle: 'strokers',
    seeAlso: ['cock-ring', 'body-safe-materials'],
  },
  {
    term: 'Butt plug',
    slug: 'butt-plug',
    definition: "A butt plug is a toy designed for anal insertion and to stay in place, tapered at the tip for easy entry, widening in the middle, and narrowing again at a flared base that prevents it from being pulled in too far. Sizes range from slim beginner shapes to larger, weighted designs, and some include vibration. Unlike toys meant for in-and-out motion, a plug is built to be inserted once and left, whether for a few minutes or during other activity. Body-safe, non-porous materials and a generous amount of lube make anal play more comfortable, since the anus doesn't self-lubricate the way other tissue does.",
    collectionHandle: 'anal',
    seeAlso: ['anal-beads', 'water-based-lube'],
  },
  {
    term: 'Anal beads',
    slug: 'anal-beads',
    definition: "Anal beads are a string or flexible shaft of graduated spheres, inserted one at a time and often withdrawn at or near the moment of orgasm, since the sensation of removal is a big part of the appeal. They range from small, closely spaced beads good for beginners to larger, more widely spaced ones for more experienced use. A sturdy pull ring or loop at the end matters, since it's what makes safe, controlled removal possible. As with any anal toy, a flared or looped end that can't be fully pulled inside is a non-negotiable safety feature.",
    collectionHandle: 'anal',
    seeAlso: ['butt-plug', 'prostate-massager'],
  },
  {
    term: 'Body-safe materials',
    slug: 'body-safe-materials',
    definition: "Body-safe materials are non-porous, non-toxic substances that won't harbor bacteria, leach chemicals, or irritate skin with regular use, the baseline standard for anything designed to touch or enter the body. Medical-grade silicone, glass, and stainless steel are the most common body-safe choices because they're non-porous and can be cleaned thoroughly between uses. Materials to watch for include unlabeled jelly or PVC blends, which are often porous and can contain phthalates. Checking the material name on a product page, not just the marketing language around it, is the simplest way to know what's actually being used.",
    collectionHandle: null,
    seeAlso: ['medical-grade-silicone', 'borosilicate-glass'],
  },
  {
    term: 'Medical-grade silicone',
    slug: 'medical-grade-silicone',
    definition: "Medical-grade silicone is a non-porous, hypoallergenic silicone formulation used in medical devices and body-safe toys because it doesn't harbor bacteria and holds up to repeated cleaning without degrading. It has a soft, skin-like give that many people prefer for both external and internal use, and it can typically be cleaned with mild soap and water or boiled briefly for a deeper clean. It should be paired with water-based lube, since silicone-based lube can degrade silicone toy surfaces over time. Not all silicone-labeled products are medical-grade, so a specific material callout on the product page is the detail to look for.",
    collectionHandle: null,
    seeAlso: ['body-safe-materials', 'silicone-based-lube'],
  },
  {
    term: 'Borosilicate glass',
    slug: 'borosilicate-glass',
    definition: "Borosilicate glass is a strengthened glass, the same type used in lab equipment and bakeware, chosen for toys because it's non-porous, scratch-resistant, and can handle temperature play by being warmed or cooled before use. It's firmer than silicone, which gives more direct, precise pressure, and it's compatible with any type of lube since there's no surface for lube to react with. Despite the glass name, quality borosilicate toys are built to resist shattering under normal use, though they should still be inspected for chips or cracks before each use. It can be sterilized by boiling, which makes it easy to share safely between partners or toys.",
    collectionHandle: 'dildos',
    seeAlso: ['body-safe-materials', 'g-spot'],
  },
  {
    term: 'Water-based lube',
    slug: 'water-based-lube',
    definition: "Water-based lube is a lubricant formulated with water as its main ingredient, making it compatible with all toy materials, including silicone, and safe to use with latex condoms. It washes off easily with water and doesn't stain sheets, though it can dry out faster than other lube types during longer sessions, sometimes needing a reapplication or a few drops of water to reactivate it. It's the safest default choice when unsure what a toy is made of, since it won't degrade any material. Formulas vary in thickness and additives like glycerin, so checking the ingredient list matters for anyone prone to irritation.",
    collectionHandle: 'lubricants',
    seeAlso: ['silicone-based-lube', 'body-safe-materials'],
  },
  {
    term: 'Silicone-based lube',
    slug: 'silicone-based-lube',
    definition: "Silicone-based lube is a lubricant made from silicone polymers rather than water, prized for lasting much longer without reapplication and holding up well in water, like in a shower or bath. It's a poor match for silicone toys, since the two silicones can interact and degrade the toy's surface over time, so it's best reserved for glass, steel, or condom-only use. It's also harder to wash off skin and fabric than water-based lube, usually needing soap rather than water alone. For anyone who wants long-lasting glide without those tradeoffs, checking toy material against lube type first avoids the issue entirely.",
    collectionHandle: 'lubricants',
    seeAlso: ['water-based-lube', 'medical-grade-silicone'],
  },
  {
    term: 'App-controlled toy',
    slug: 'app-controlled-toy',
    definition: "An app-controlled toy connects over Bluetooth to a smartphone app, letting intensity, patterns, and sometimes real-time audio or interactive sync be adjusted from the phone instead of buttons on the toy itself. This opens up long-distance control between partners, custom vibration patterns, and sync with music or video content, depending on the app's features. Range and connection reliability depend on the app and Bluetooth version, so checking recent reviews for connectivity issues is worth doing before buying. Privacy is worth a glance too, since app permissions and data handling vary by manufacturer.",
    collectionHandle: 'remote',
    seeAlso: ['remote-control-toy', 'wand-massager'],
  },
  {
    term: 'Remote-control toy',
    slug: 'remote-control-toy',
    definition: "A remote-control toy is operated by a separate handheld remote or a smartphone app rather than buttons on the toy body, which is why it's a common choice for wearable toys meant to be controlled by a partner or used hands-free. Range varies widely, from a few feet for basic RF remotes to app-based options that can work over the internet for long-distance couples. Handheld remotes tend to be simpler and more reliable in public settings, since they don't depend on a Bluetooth connection or phone battery. Discretion features like silent vibration or a low-profile remote matter most for anyone planning to use one outside the house.",
    collectionHandle: 'remote',
    seeAlso: ['app-controlled-toy'],
  },
  {
    term: 'Aftercare',
    slug: 'aftercare',
    definition: "Aftercare is the time and attention given to physical and emotional wellbeing after sex or a scene, whether that's cuddling, talking, water, or simply quiet space to come down. It's especially emphasized after intense or kink-oriented play, but it's a useful practice after any sexual experience, solo or partnered. What aftercare looks like is personal, some people want closeness and conversation, others want quiet or time alone, and checking in about preferences ahead of time helps. Basic self-care after using toys also belongs in this category, cleaning and properly storing them, and gently checking in with your own body afterward.",
    collectionHandle: 'wellness',
    seeAlso: ['kegel-exerciser'],
  },
]

async function main() {
  const slugs = new Set(TERMS.map(t => t.slug))
  for (const t of TERMS) {
    for (const s of t.seeAlso) {
      if (!slugs.has(s)) throw new Error(`Term "${t.slug}" references unknown seeAlso slug "${s}"`)
    }
  }

  const plan = TERMS.map(t => `createOrReplace blogGlossaryTerm.${t.slug}${t.collectionHandle ? ` → /collections/${t.collectionHandle}` : ''}`)

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, terms: TERMS.length, plan }, null, 2))
    return
  }

  // Pass 1: the term docs themselves (no seeAlso yet, so forward references
  // in the list never point at a doc that doesn't exist).
  const tx = client.transaction()
  for (const t of TERMS) {
    tx.createOrReplace({
      _id: `blogGlossaryTerm.${t.slug}`,
      _type: 'blogGlossaryTerm',
      term: t.term,
      slug: { _type: 'slug', current: t.slug },
      definition: t.definition,
      ...(t.collectionHandle ? { collectionHandle: t.collectionHandle } : {}),
    })
  }
  await tx.commit()

  // Pass 2: wire seeAlso references.
  const tx2 = client.transaction()
  for (const t of TERMS) {
    if (!t.seeAlso.length) continue
    tx2.patch(`blogGlossaryTerm.${t.slug}`, p =>
      p.set({
        seeAlso: t.seeAlso.map((s, i) => ({
          _type: 'reference',
          _ref: `blogGlossaryTerm.${s}`,
          _key: `see-${i}-${s.slice(0, 24)}`,
        })),
      }),
    )
  }
  await tx2.commit()

  console.log(JSON.stringify({ done: true, terms: TERMS.length }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
