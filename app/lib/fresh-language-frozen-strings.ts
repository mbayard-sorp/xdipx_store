/**
 * Frozen-safety-string allowlist for the fresh-language cross-post reuse
 * check (ticket #23880).
 *
 * routine-content-daily.md's Step 5 item 3 ("one shared rewrite cycle") says
 * a safety enumeration, material limit, or never/only instruction is frozen
 * exactly as published, and that the fresh-language rule does NOT apply to
 * it: "an exact repeated safety phrase across posts is correct and
 * preferable to a fresh but looser paraphrase." check-fresh-language.ts had
 * no way to honor that carve-out, so the mandated, verbatim IPX7 house
 * wording (quoted in that same doc, reused identically across 15+ published
 * Notebook posts as of 2026-11-23) reports as recycled language on every
 * post that correctly reuses it — a checker artifact, not a defect (run
 * 2161; run 2175, /notebook/how-do-you-choose-a-personal-massager vs
 * /notebook/do-you-need-a-sex-toy-cleaner, where all 35 remaining shared
 * 6-grams sat inside this one sentence).
 *
 * Each entry here is stripped from BOTH the draft and every prior post's
 * text before 6-grams are computed (see stripFrozenStringsFromDoc), so a
 * verbatim frozen string can never produce a hit while all surrounding
 * prose is still compared exactly as before. An entry is exact-match only:
 * changing even one word of it is a paraphrase, not a reuse of the frozen
 * string, and stays caught like any other recycled phrase.
 */

/**
 * The IPX7 house wording, quoted verbatim in routine-content-daily.md's
 * IP-rating paragraph and confirmed byte-identical across the live Sanity
 * corpus (2026-11-23 spot check: air-pulse-vs-clitoral-suction,
 * how-do-couples-use-a-prostate-massager-together,
 * how-do-wearable-vibrators-work, how-do-you-choose-a-personal-massager,
 * how-do-you-use-a-clitoral-suction-toy, how-do-you-use-a-prostate-massager,
 * how-do-you-use-a-sex-toy-safely, remote-vs-app-controlled-long-distance-toy,
 * what-does-a-wand-vibrator-do, what-is-the-p-spot-and-what-toy-reaches-it,
 * what-makes-a-great-g-spot-rabbit-vibrator, among others).
 */
export const IPX7_HOUSE_WORDING =
  'IPX7 covers immersion only: one metre, thirty minutes. Running water and jets carry their own ratings, ' +
  'those ratings do not stack onto an IPX7 mark, and an IPX7 toy therefore comes with no promise about a shower or a tap.'

/**
 * The IPX4 house wording, matching routine-content-daily.md's informal spec
 * ("IPX4 = splashes only, keep out of the shower and never submerge") in the
 * exact phrasing already published on how-do-you-choose-a-personal-massager.
 * Unlike IPX7, IPX4 has not yet converged to a single wording reused
 * verbatim across every post (content-daily.md gives only the informal
 * spec, and the live corpus shows many different correct paraphrases of it),
 * so this entry will not strip anything out of most existing posts today —
 * it is seeded here so the one IPX4 phrasing the content team DOES reuse
 * verbatim is exempt the same way IPX7 is, and so the module has a home for
 * an IPX4 house wording if content-daily.md pins one down the way it already
 * has for IPX7.
 */
export const IPX4_HOUSE_WORDING =
  'IPX4 covers splashes only, so keep it out of the shower and never submerge it.'

/**
 * The IPX5/IPX6 jet-code house wording. SECOND OCCURRENCE of the #23880
 * class (ticket #24095): content run 2095 remediated
 * `/notebook/how-often-should-you-clean-your-vibrator` block b10 into this
 * wording, #22828 then required the next post to agree with it, and content
 * run 2193 applied it to `/notebook/what-makes-a-vibrator-body-safe` block
 * b19 (quoted here verbatim) plus blocks b47 and b61 — both gates PASSED on
 * that reuse, the voice gate ruling explicitly that near-verbatim reuse of a
 * frozen safety sentence is not a fresh-language defect. Taken from b19
 * specifically, not b47 or b61, because b19 is the version both gates
 * cleared with the charging-port instruction as a bare imperative ("Keep the
 * charging port out of the stream") rather than hung off the sealed-as-made
 * clause.
 */
export const IPX56_JET_CODE_HOUSE_WORDING =
  'IPX5 and IPX6 are the jet codes. Each names its own nozzle test at a set flow, which is a pressurised ' +
  'spray rather than the free-falling stream out of your tap, so a toy carrying either is built to take a ' +
  'rinse. Both tests run on a new toy sealed the way its maker intended, with water at room temperature. ' +
  'Keep the charging port out of the stream, and keep hot water off anything with a motor in it.'

/** Exact, mandated safety sentences exempt from the fresh-language check. */
export const FROZEN_SAFETY_STRINGS: readonly string[] = [
  IPX7_HOUSE_WORDING,
  IPX4_HOUSE_WORDING,
  IPX56_JET_CODE_HOUSE_WORDING,
]

/**
 * Remove every exact occurrence of a frozen string from `text`, replacing it
 * with a single space so word boundaries on either side of the cut never
 * fuse into a new, unintended shared phrase. Exact substring match only.
 */
export function stripFrozenStrings(
  text: string,
  frozen: readonly string[] = FROZEN_SAFETY_STRINGS,
): string {
  let out = text
  for (const s of frozen) {
    if (!s) continue
    out = out.split(s).join(' ')
  }
  return out
}

/** Minimal shape of a Portable Text block this module needs to touch. */
interface PtBlockLike {
  _type?: string
  children?: { text?: string }[]
}

/** Minimal shape of a blogPost draft or prior post this module needs to touch. */
interface DocLike {
  title?: string | null
  excerpt?: string | null
  body?: unknown
}

/**
 * Return a copy of a blogPost draft or prior post with every frozen string
 * stripped from its title, excerpt, and body block text. Structure
 * (block/style/children shape) is preserved untouched; only `children[].text`
 * is rewritten, so this is safe to run before handing the doc to
 * app/lib/fresh-language.ts's toTextUnits/analyzeFreshness exactly as before.
 */
export function stripFrozenStringsFromDoc<T extends DocLike>(
  doc: T,
  frozen: readonly string[] = FROZEN_SAFETY_STRINGS,
): T {
  const body = Array.isArray(doc.body)
    ? (doc.body as PtBlockLike[]).map(block => {
        if (!block || block._type !== 'block' || !Array.isArray(block.children)) return block
        return {
          ...block,
          children: block.children.map(c =>
            typeof c.text === 'string' ? { ...c, text: stripFrozenStrings(c.text, frozen) } : c,
          ),
        }
      })
    : doc.body

  return {
    ...doc,
    title: typeof doc.title === 'string' ? stripFrozenStrings(doc.title, frozen) : doc.title,
    excerpt: typeof doc.excerpt === 'string' ? stripFrozenStrings(doc.excerpt, frozen) : doc.excerpt,
    body,
  }
}
