# Health Reviewer Workflow (E-E-A-T)

Ticket #12096, tracker `p2-5-eeat`. Defines the human-expert-review identity, eligibility, and
attribution process for health-adjacent Notebook posts. Pairs with the AI-side accuracy gate
(`sex-wellness-reviewer`, run inside every `content-writer` pass) without replacing it: the AI gate
checks a draft before it ever publishes; this workflow is a real named person standing behind
specific *published* pieces, which is what E-E-A-T (experience, expertise, authoritativeness,
trustworthiness) actually asks a health-adjacent page to show a reader and a search engine.

## What "health-adjacent" means here

`docs/store-team/content-plan.md` already marks specific Real Talk topic rows with `†` ("health-adjacent;
the 'worth seeing a clinician if…' line is mandatory") — roughly a third of the bank by that doc's own
composition note. That marking is the working definition: a post is health-adjacent when its topic
involves anatomy, physiology, a medical or psychological symptom, or anything where a reader might
reasonably wonder whether to see a clinician. Rows marked `†` in the content plan are exactly this set.
There is no separate Sanity flag for it — the signal that a post has actually been reviewed is the
`blogPostExtras.reviewer` reference itself, not a category or tag. A health-adjacent post with no
reviewer set is not mislabeled; it simply has not been through this workflow yet.

## Reviewer identity: `healthReviewer` (additive Sanity doc)

Fields: `name`, `slug`, `credentials`, `bio`, `photo`, `active`. Deliberately separate from
`editorialAuthor` (the existing AI voice-profile framework that answers "whose voice wrote this
copy") — a `healthReviewer` answers "who actually checked this piece is accurate", a different
question with a different, much higher bar.

**Who may be a `healthReviewer`.** A real, named person with real, publicly verifiable credentials
relevant to sexual wellness content — a licensed clinician (MD, NP, RN, PA), a licensed or certified
mental health professional, or a certified sex educator (e.g. AASECT-certified). The credential
string on the doc must be the literal, checkable credential ("RN, AASECT-certified sex educator"),
never a vague or invented title.

**Creating a `healthReviewer` doc is an owner decision, not a run's.** Whoever creates the identity
is vouching, in public, that this named person exists, holds the stated credential, and has agreed
to be publicly attributed as a reviewer of xdipx content. No routine, agent, or ticket may invent a
reviewer identity to satisfy a metric. Doing so — or attaching a real reviewer's name to a post they
did not actually review — is exactly the "never fabricate proof" rule in `docs/design-doctrine.md`
§6, applied to a byline instead of a testimonial.

## Attaching a review to a post

1. The reviewer actually reads the published (or review-ready draft) post and checks it for factual
   and clinical accuracy — the same category of check `sex-wellness-reviewer` already runs
   automatically (anatomy/physiology accuracy, no hallucinated statistics or studies, materials and
   safety claims, realistic expectations, current terminology), but by a human who can catch what an
   automated pass cannot and who is willing to be named.
2. On approval, set `blogPostExtras.reviewer` (a reference to the `healthReviewer` doc) on that
   specific post's extras document. Optionally also set or update `reviewedNote` with a short,
   specific trust line (the field already existed pre-#12096; it renders in the same "Sources &
   review" footer as the byline).
3. The post page (`app/routes/_layout.notebook.$slug.tsx`) renders the byline automatically via
   `<ReviewerByline>` whenever `extras.reviewer` resolves to an `active` reviewer — no further code
   change needed per post.
4. If a post is revised in a way that could affect the parts the reviewer checked, re-review it
   before the byline is considered current. There is no automatic expiry field in this first pass;
   treat a stale byline as a content-quality issue to catch in the normal Notebook health sweeps, not
   as something code enforces yet.

## Deactivating a reviewer

Set `healthReviewer.active` to `false` rather than deleting the doc. Existing posts keep their
historical byline (a review that happened is a fact, even after the reviewer stops working with
xdipx); `<ReviewerByline>` will not render a new byline for an inactive reviewer's doc, but the
`reviewer` reference itself stays for the historical record.
