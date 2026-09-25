# ADR-015: Product anatomy-target classification and the cast/product casting gate

Date: 2026-09-22
Status: Proposed
Author: tech-architect
Implementation owner: rr7-engineer (derivation function, gate module, backfill script), sanity-content-builder (`castMember` additive field), product-manager (spot-fixes overrides during normal queue review, not a new routine)

## Context

Incident: Instagram row 293 showed Marcus (male cast member) alone, holding a ROMP
Presto Wand (`product_type_dial=vibrator`, `product_subtype_dial=wand`) at chest
height. Owner, verbatim: "When we have a man holding a vibrator; we look like
idiots." Refined twice: "If you want to show a man holding a vibrator he should
be holding it against a woman's skin" and "A man should show products that men
use!" Owner direction 2026-09-22: bind merchandising and social agents to a
male/female/universal product classification, and require the social team to
check it before casting a male or female cast member solo with a product.

**Verified in the tree before this ADR:**

- `ProductTypeDial` (19-value closed top-level enum) and `ProductSubtypeDial`
  (closed, scoped per parent) already exist at `app/types/index.ts:49-113`,
  mirrored in `PRODUCT_SUBTYPES_BY_TYPE` (`app/lib/claude.server.ts:2747`).
  `emma-product-enricher` classifies every product into this taxonomy today
  (`.claude/agents/emma-product-enricher.md:69-107`) as part of the standard
  `ProductWrites` payload (`app/lib/emma-orchestrator.server.ts:77`).
- `xdipx.audience_tags` is **not** a gender axis. The live Ask Emma vocab is
  "solo / couples / gift" (`app/lib/claude.server.ts:2881`,
  `emma-product-enricher.md:59`: "typically me, us, gift"). A **different,
  legacy** axis lives in `app/lib/gmc-metafields.server.ts:51-82`
  (`gmcGender`/`gmcCustomLabel1`), which reads literal `'for-him'`/`'for-her'`
  strings out of `audienceTags` for the Google Merchant Center feed. Nothing
  in the current enrichment vocab writes those strings, so `gmcGender` almost
  certainly resolves to `'unisex'` catalog-wide today unless the separate
  `custom.gmc_gender` Shopify-app metafield is set
  (`app/lib/shopify.server.ts:1933`). This is a live, independent bug worth a
  follow-up ticket, and it is also the cautionary tale for this ADR: **do not
  reuse or extend `audience_tags` for gender/anatomy** — it is already
  overloaded once and the overload is silently broken.
- `castMember` (`studio/schemas/castMember.js`) has no gender/presentation
  field. Presentation exists only as free text inside `description`, e.g.
  "Latino man presenting late 20s", "Black woman presenting early 30s". The
  file already has a clean additive-extension pattern: three sibling files
  (`castMemberEditorialFields.js`, `castMemberVoiceFields.js`,
  `castMemberBodyFields.js`) are imported and spread into `castMember.js`'s
  `fields` array, one spread line per ticket, original fields untouched. Live
  roster (eight, all `active`+`approvedForUse`): Diego, Marcus (masculine);
  Emma, Jade, Maya, Priya, Sofia, Vivian (feminine).
- `/for-him` and `/for-her` are permanently retired and 301 away
  (`app/routes/_layout.for-him.tsx:5-9`: "never redirect to the gendered
  /collections/for-him"). This is a customer-facing merchandising posture,
  not an imagery-casting constraint — the new field must never be surfaced
  storefront-side, in navigation, in SEO, or reused to resurrect gendered
  collections.
- `social_posts.castSlugs` (`jsonb`, `db/schema.ts:240/330/2021`, migration
  084) already exists and is populated per post. The casting decision itself
  is made by `social-art-director` (opus, judgment-only, no code enforcement)
  at brief time (`.claude/agents/social-art-director.md`), and is verdicted
  by `social-publish-gate` (also judgment-only by design:
  "reviews strings, never opens the images" —
  `.claude/agents/social-publish-gate.md`). There is direct, on-the-record
  precedent in this codebase for **not** trusting a judgment-only LLM step
  with a fact that is checkable from data:
  `app/lib/social-vision-gate.server.ts:1-30` was built after social_posts
  #145 shipped a three-armed cast member because "the vision gate" was
  doctrine text and agent judgment, never code. Its header states the
  operative principle this ADR follows: *"'Could not check' and 'checked
  and it's fine' are different answers, and only the second one is
  `pass: true`."* — i.e. fail closed on missing data, not open.
- `social-art-director.md`'s own `<role>` section documents the general
  failure mode at play: a single agent juggling product choice + caption +
  scene + cast + variety under load "reverted to the safest frame every
  time" until scene variety got its own owner. Loading one more judgment
  call ("is this cast/product pairing okay?") onto an already-overloaded
  agent repeats that mistake. A deterministic check is the fix, not a
  longer prompt.
- `docs/store-team/instagram-campaigns.md` §3.6 ("cast holds the product
  itself," owner ruling 2026-08-12) and §3.7 (cast-in-scene mandate, owner
  ruling 2026-08-19) already govern *that* a cast member holds product; they
  say nothing about *which* cast member may hold *which* product. This ADR
  is additive to that doctrine, not a change to it.

## Decision

### 1. Mechanism — derive with a never-null default, allow an explicit override

New Shopify metafield: **`xdipx.cast_target`**, string, closed values
**`'male' | 'female' | 'universal'`**. (Plain "male"/"female," not a euphemism —
the existing taxonomy already uses this vocabulary in-band for the identical
concept: `enhancer` subtypes `male-arousal`/`female-arousal`, `wear` subtype
`mens-underwear`. Inventing a parallel vocabulary here would be pure
translation risk for no benefit — this field is production/admin metadata,
never customer-facing, so the store's ungendered *merchandising* posture does
not apply to it.)

Reject pure human tagging (option a) outright: 500+ live products, no existing
pipeline step owns it, and CLAUDE.md's own launch-checklist lesson (fields
that start empty are inert on day one) applies directly.

Reject pure derivation with no override (option b): the mapping below is a
good default but has known judgment-call edges (see the `sex-machine` and
`harness` rows). An agent or the owner needs a way to correct a specific SKU
without a schema change or a special case in the derivation function.

**Recommendation: (c) — deterministic derivation off the taxonomy that
already exists, computed by code (not by the LLM enricher), with an explicit
metafield override that always wins.**

Why code, not `emma-product-enricher` judgment: the enricher already emits
`productTypeDial`/`productSubtypeDial` in every `ProductWrites` payload
(`emma-orchestrator.server.ts:77`). `cast_target` is a pure, deterministic
function of those two closed enums — the same shape as the `gmcGender` /
`gmcProductCategory` functions that already exist in
`gmc-metafields.server.ts`. Asking an LLM to re-derive a lookup-table fact
adds token spend, adds a place it can drift from the taxonomy it was just
given, and adds one more judgment call to a prompt that is already carrying a
lot (title, tagline, SEO, sensation dial, FAQs, pairings). Compute it in code;
let a human (or `product-manager` during ordinary queue review) write the
override metafield only for the genuine edge cases.

**Derivation table** (default when no `xdipx.cast_target` override is set),
keyed off `product_type_dial` first, `product_subtype_dial` second:

| `product_type_dial` | Default | Subtype overrides |
|---|---|---|
| `vibrator` | `female` | — |
| `dildo` | `female` | `packer` → `male` |
| `anal` | `universal` | `prostate` → `male` |
| `bondage` | `universal` | — |
| `cock-ring` | `male` | — |
| `stroker` | `male` | — |
| `couples` | `universal` | — |
| `harness` | `universal` | — |
| `extender` | `male` | `strap-on` → `universal` |
| `pump` | `male` | — |
| `lube` | `universal` | — |
| `massage` | `universal` | — |
| `enhancer` | `universal` | `male-arousal` → `male`, `female-arousal` → `female` |
| `wear` | `universal` | `mens-underwear` → `male`; `panty`/`bra-panty-set`/`bodysuit-teddy`/`bodystocking`/`hosiery`/`pasty`/`plus-queen` → `female` |
| `condom` | `universal` | — |
| `wellness` | `universal` | `kegel` → `female` |
| `novelty` | `universal` | — |
| `book-media` | `universal` | — |
| `sex-machine` | `universal` | — (no subtype; flag for manual review given real ambiguity here) |

This table is a starting point for `rr7-engineer` to encode as a pure
function (e.g. `deriveCastTarget(typeDial, subtypeDial): 'male'|'female'|
'universal'`) — not a promise that every row is right. `harness` and
`sex-machine` are the two rows with the weakest signal and are the most
likely to need per-SKU overrides.

Backfill: a one-time script (pattern: `scripts/backfill-cast-metadata.ts`
already in the repo) runs the derivation against the existing
`product_type_dial`/`product_subtype_dial` metafields for all live products
and writes `xdipx.cast_target` in one pass. This is what makes the field
non-inert on day one — every live product gets a value from data that
already exists, with zero new editorial work. Going forward,
`applyFullEnrichmentWrites()` (`app/lib/import-enrich.server.ts:186`) computes
and writes the default at enrich time, **unless a `xdipx.cast_target` value
already exists on the product**, so a manual override survives re-enrichment.

### 2. Value set — binary-plus-universal is sufficient, anatomy nuance stays internal to the derivation

The owner named three buckets (men/women/universal) and that is exactly
right for the *casting* decision, which only ever needs to answer "can this
cast member be shown alone with this product." A richer axis (vulva/vagina,
penis, prostate, non-anatomical) would be more descriptive but buys nothing
at the gate — it would immediately collapse back to the same three buckets
via a second lookup. Keep the richer nuance where it already lives (the
`product_subtype_dial` taxonomy itself, e.g. `prostate` under `anal`) and let
`cast_target` be the flattened, gate-ready projection of it. Three values,
not four or five.

### 3. Cast side — additive `castMember` field, small one-time backfill

Add `studio/schemas/castMemberCastingFields.js` (new file, additive) exporting
one field:

```js
{
  name: 'bodyPresentation',
  title: 'Body presentation (imagery casting)',
  type: 'string',
  options: { list: [
    { title: 'Masculine', value: 'masculine' },
    { title: 'Feminine', value: 'feminine' },
  ]},
  description:
    'Which body-target products (xdipx.cast_target) this presenter may be ' +
    'shown alone with. Production/casting metadata only — never surfaced ' +
    'storefront-side. Backfilled once for the 8-member roster from the ' +
    'existing description field; owner ruling 2026-09-22.',
}
```

Spread it into `castMember.js`'s `fields` array exactly as the three prior
tickets did (one new import, one new spread line — the file's own established
and intended extension mechanism, not a violation of the additive-only rule).

This is a five-minute manual Sanity edit, not a new pipeline: 8 rows, and the
free-text `description` field already states the answer for every current
member ("...man presenting...", "...woman presenting..."). No new agent
routine is needed to populate it; `sanity-content-builder` or the owner sets
it once at rollout, and it becomes a normal field on any future cast member
added afterward (the same governance gate — `active` + `approvedForUse` — that
already blocks an unapproved look blocks an un-set `bodyPresentation` too, if
the gate treats missing presentation as a hard stop; see §5).

### 4. Gate placement — one deterministic module, two call sites, no vision model needed

New file: `app/lib/social-cast-target-gate.server.ts` (naming mirrors
`social-vision-gate.server.ts` on purpose — same "code enforcement of what
used to be doctrine + judgment" pattern, same precedent). Pure data check,
no image/model call required:

```
checkCastTargetMatch(castTarget: 'male'|'female'|'universal', castSlugs: string[], roster: CastMember[]): { pass: boolean; reason?: string }
```

Rule: `universal` always passes. For `male`/`female`, resolve each
`castSlug` to its `bodyPresentation`. If exactly one cast member is in
frame, that member's presentation must match. If two or more are in frame
(the owner's own "against a woman's skin" refinement — a mismatched cast
member may appear *with* a matching one, never alone), **at least one**
member's presentation must match the product's target.

Call it from two places, defense in depth:
1. **`social-art-director`**, before it hands a brief to `media-manager` —
   catches the mismatch before any image-generation spend, and lets the
   agent simply pick a different cast slate or add a matching second member,
   the same self-repair shape it already has for other constraints.
2. **`social-publish-gate`**, as a hard `BLOCK` reason alongside the existing
   vision-gate and voice-gate checks — defense in depth for the admin
   `CastPicker`/rework path (`app/components/admin/social/CastPicker.tsx`,
   `social-admin-rework.server.ts`), which can recast a post after
   art-director's brief without going back through step 1.

One file, one function, two callers — not a second implementation at either
site. This keeps the "one vendor per concern" posture: the rule lives in
exactly one place, same as the imagery ceiling in §3.2a lives in exactly one
markdown doc and every agent points at it instead of restating it.

### 5. Failure mode — fail closed, and make that cheap by backfilling first

**Fail closed.** Treat "no `xdipx.cast_target` on the product" or "no
`bodyPresentation` on a cast member in frame" the same as a hard mismatch:
`BLOCK`, never `PASS`. This is the same call the codebase already made for
vision-gate ("could not check" ≠ "checked and it's fine") and for
`social-art-director`'s existing rule that a missing approved cast member
degrades the day's product-post capacity to zero rather than silently
substituting a product-only frame. A missing classification is not evidence
of safety; it is evidence nobody checked, and the actual incident this ADR
answers is exactly a case where shipping was the wrong call.

This does collide with the zero-day doctrine ("a run that posts nothing is a
failed run," `docs/store-team/social-slate-2026-09-06` / PR #1109) — but that
doctrine was written for *process* failures (rejections silently eating
quota, no day-close alarm), not for a substantive brand-safety miss, and the
fix here is designed specifically so fail-closed rarely fires in practice:
the backfill in §1 means `xdipx.cast_target` is populated for effectively the
whole live catalog before this gate ever ships, and every product enriched
from that point forward gets a default at enrich time, never `null`. The
`bodyPresentation` backfill in §3 covers all 8 live cast members the same
day. Post-rollout, "missing" should be a near-zero-occurrence case — the
right response to that rare case is `social-art-director` picking a
different in-stock product or a matching cast member, not shipping a frame
nobody vetted for the exact failure mode the owner just named.

## Alternatives considered

- **Reuse `xdipx.audience_tags` for gender.** Rejected. It is a different
  axis today (solo/couples/gift) and a *dead second meaning*
  (`for-him`/`for-her`) already exists for it in `gmc-metafields.server.ts`
  and is silently broken. Piling a third meaning onto one field is exactly
  the kind of overload this codebase has already been burned by once.
- **Let `emma-product-enricher` emit `cast_target` as another LLM judgment.**
  Rejected. It is a pure function of two enums the enricher already
  produces; asking the model to re-derive it adds cost and drift risk for
  zero benefit over a lookup table.
- **Only check at `social-publish-gate`, skip the art-director pre-check.**
  Viable but wasteful — a caught-late mismatch means a wasted image
  generation and a wasted `media-manager` pass. Checking at brief time is
  the cheap, early failure; the gate-time check stays as defense in depth
  for the admin recast path, which the brief-time check cannot see.
- **Fail open on missing data ("post anyway, flag it").** Rejected for the
  reason in §5 — it reproduces the exact incident this ADR exists to
  prevent, and the backfill step means the cost of failing closed (a
  same-day re-brief, occasionally) is small and shrinking, not a chronic
  zero-day generator.

## Consequences

- New Shopify metafield `xdipx.cast_target` (namespace `xdipx`, consistent
  with `product_type_dial` et al.), backed by a deterministic derivation
  function + one-time backfill script + an enrich-time write-if-absent.
- New additive Sanity field `castMember.bodyPresentation`, one new file, one
  new spread line in `castMember.js`, one manual backfill of 8 rows.
- New deterministic gate module `app/lib/social-cast-target-gate.server.ts`,
  called from `social-art-director`'s brief step and from
  `social-publish-gate`'s verdict logic.
- `docs/store-team/instagram-campaigns.md` gets a new subsection (§3.10 or
  next available) pointing at this ADR and stating the rule in doctrine
  terms, mirroring how §3.2a/§3.2c are pointed-at rather than restated
  elsewhere — implementation detail for whoever writes it, not specified
  further here.
- Follow-up ticket (separate from this ADR): `gmcGender`/`gmcCustomLabel1`
  almost certainly resolve to `unisex`/`unisex` catalog-wide today because
  nothing writes `for-him`/`for-her` into `audienceTags` anymore. Worth its
  own investigation; out of scope here since it feeds the Google Merchant
  Center product feed, not imagery casting, and reusing this ADR's field for
  it would be exactly the overload this ADR just avoided creating.
- No change to customer-facing routes, navigation, SEO, or the retired
  `/for-him`/`/for-her` redirects. `cast_target` is production/admin
  metadata only; nothing in this ADR authorizes surfacing it storefront-side.
