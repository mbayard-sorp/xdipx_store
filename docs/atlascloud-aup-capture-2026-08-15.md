# Atlas Cloud acceptable-use capture — first-party, 2026-08-15

Captured by: interactive Claude session (all-hands 2026-08-15), from the local
network (the cloud-routine network egress-blocks atlascloud.ai, which is why
the 2026-08-09 spike could not produce this artifact — see
`docs/media-providers-atlascloud-spike.md` §2 and ADR-010 gate 1).

Two pages were fetched first-party with curl on 2026-08-15:

1. `https://www.atlascloud.ai/docs/acceptable-use` (the docs summary)
2. `https://www.atlascloud.ai/acceptable-use` (the full legal terms the summary
   links to as authoritative; page header "Last Updated: December 2025")

## What the docs summary says (verbatim extracts)

> This page summarizes Atlas Cloud's acceptable use policy. For the full legal
> terms, visit atlascloud.ai/acceptable-use.

Prohibited Uses (docs summary, complete list):

> You may not use Atlas Cloud to:
> - Generate illegal, harmful, or abusive content
> - Create malware, spam, or phishing content
> - Generate hate speech, harassment, or discriminatory content
> - Reverse engineer Atlas Cloud services
> - Build competing products using our APIs
> - Systematically scrape data from our platform
> - Violate any applicable laws or regulations

Note: **no adult-content clause in the docs summary.**

Enforcement (docs summary):

> Atlas Cloud reserves the right to suspend or terminate accounts that violate
> this policy at any time without notice. Remaining credits may be forfeited
> upon termination for policy violations.

## What the full legal AUP says (verbatim extract, §7 Prohibited Uses)

> Customer will not:
> - Attempt to reverse engineer or decompile any part of the Services;
> - Use the Services to build a competitive product;
> - Systematically retrieve data to create a database or directory;
> - **Use the Services for illegal/adult content, hate speech, or malware.**

(Emphasis added. §7 also prohibits publishing benchmark results without written
consent — relevant if we ever publish model comparisons; internal testing is
expressly permitted.)

Financial terms that shape the risk (full AUP §4): all purchases final,
non-refundable, credits expire in 365 days, and termination for violations
forfeits remaining balance.

## The contradiction

The full legal AUP prohibits using the service for "adult content" while Atlas
Cloud's own live catalog carries and markets NSFW model tiers (first-party: the
`/models/media` catalog page ships assets for `alibaba-wan-2.2-spicy-*` models;
search-surfaced marketing describes the platform as built for professional
adult content creators without content moderation barriers). The docs summary
of the same policy omits the adult clause entirely.

The most plausible reading is that the legal page is boilerplate that lags the
product (a platform whose flagship differentiator is "Spicy" models is not
operationally enforcing a no-adult-content clause). But contractually the
prohibition exists, enforcement is "at any time without notice," and credits
are forfeitable.

## xdipx exposure assessment

What xdipx generates on Atlas: marketing imagery of sexual-wellness products —
suggestive, never pornographic, no nudity, no sexual acts depicted, real
products with consenting-adult cast members whose likeness the store owns (the
approved castMember roster). Under the charter this is closer to "retail
product photography" than "adult content," and it is far tamer than the output
of the NSFW models Atlas itself sells. Risk is judged low but nonzero, and the
asymmetry is one-sided: a termination costs remaining credits plus a pipeline
outage (which falls back to fal automatically — the `generateImage()` chain
keeps fal and Imagen as live fallbacks precisely so a provider outage degrades
rather than breaks).

## Owner actions (open)

1. Request written confirmation from Atlas (contact address is on the docs
   Contact page; it is crawler-obfuscated, read it logged in) that AI-generated,
   non-explicit sexual-wellness product marketing imagery is a permitted use.
   File the reply next to this capture.
2. Keep credit top-ups small (minimum $25 tier) until that confirmation exists,
   since balances are forfeitable on termination without notice.

Raw HTML captures from the fetch are not committed (1.5MB of JS bundle); this
extract is the artifact. Re-fetch and re-diff if Atlas updates the
"Last Updated: December 2025" stamp.
