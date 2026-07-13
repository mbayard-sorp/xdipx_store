# Notebook Redesign — Production QA Checklist

> **Precondition — launch runner.** Content and art should be live before this
> pass: run `bash scripts/notebook-launch.sh` from the repo root (real `.env`
> required). It seeds the series + glossary, generates the art candidates into
> `.notebook-art/`, and prints the per-asset upload commands for the keepers.

> One-time acceptance pass for the Notebook redesign on production (plus after any later visual
> change to the blog surfaces). Run by the owner or qa-reviewer with a real browser / preview
> access. The recurring render safety net is automated separately at
> `/cron/notebook-healthcheck` (report-only; Sentry + P1 issue on hard failure) — this checklist
> covers what a script can't judge: layout, motion, type, and rich-results eligibility.

## Pages to check

At **375 / 768 / 1440**:

1. `/notebook` (index)
2. A **guide** post with an FAQ section and a product embed (e.g. the most recent guides post)
3. A **comparison** post (different accent) and one **legacy post with no extras doc** (fallback rendering must be clean: no deck, no sources footer, no series card — nothing broken)
4. `/notebook/category/guides` (wash header) and one other category
5. `/notebook/series/first-times` (after seeding) — numbered spine list, "Part N" order correct
6. An author page (`/notebook/by/emma`) — social links render, AI-transparency note present

## Visual acceptance (per art direction)

- [ ] Masthead: Newsreader 500 wordmark, coral tick, hairline base — no heavy black bars anywhere
- [ ] Featured lockup image loads sharp and fast; text fades in without layout shift
- [ ] Category chips show the four-color identity (coral / plum / sage / neutral), not solid coral
- [ ] Cards: 2px accent top tick, serif titles, staggered reveal on scroll (and **no** animation with reduced-motion enabled)
- [ ] Post: reading-progress bar tracks scroll (2px coral, top); drop cap is plum, 3 lines, only on a paragraph-opening post
- [ ] Trust byline: Emma AI-transparency line + single ♥ beat (fires once, never loops)
- [ ] Pull quotes hang in the right margin at ≥1280px, inline full-width below
- [ ] FAQ section renders as the paper-2 wash panel, open (no accordion), TOC anchors still work
- [ ] Product embed reads as an editorial citation ("Featured in this piece", hairline CTA "Take a peek →"), never a coral banner
- [ ] Newsletter band: inline, no popups anywhere; submit → success state; subscriber lands in Klaviyo
- [ ] Next/prev footer + related row ("Keep reading") present at article end

## Performance

- [ ] Lighthouse (mobile) on `/notebook` and one post: **CLS = 0**, LCP at or better than pre-redesign, perf ≥ 90 target
- [ ] Hero images serve AVIF/WebP (check the network tab: `cdn.sanity.io/...?w=...&auto=format`) with srcset picking a sane width at 375
- [ ] No hydration warnings in the console

## SEO / structured data

- [ ] Google Rich Results test: post → Article (+ FAQPage where present, ItemList on guides); index → ItemList; series page → CollectionPage/ItemList
- [ ] `curl -I https://xdipx.com/notebook/<slug>.md` → 200, `content-type: text/markdown`
- [ ] `https://xdipx.com/notebook/rss.xml` valid; sitemap includes posts, categories, and (after seeding) series URLs
- [ ] Canonicals: post self-canonical; `?category=` faceted view noindex,follow; tag archives noindex

## Content

- [ ] Sources & review footer appears only on posts with a `blogPostExtras` sources/reviewedNote
- [ ] Series kicker ("FIRST TIMES · PART 2 OF 5") matches the seeded order
- [ ] All copy reads on-charter (no em-dashes, no urgency, CTA whitelist)

Log the result (pass/fail + screenshots) in the run summary or the design changelog.
