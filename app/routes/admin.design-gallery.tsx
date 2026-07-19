/**
 * /admin/design-gallery — the design-elevation `p1-gallery` surface.
 *
 * A stable, isolated inventory of the xdipx design system: the v3 token set and
 * the exported, reusable storefront component vocabulary, each in a labeled,
 * anchored frame. This is the screenshot-harness target (design-elevation
 * `p2-snapshots`) and the `design-critic`'s input. It is `docs/design-doctrine.md`
 * made visible, so the critic has an answer key it can see and score against.
 *
 * v1 scope: tokens + the exported component vocabulary + a live mount of the
 * Sensation Map instrument (the `#components-sensation-map` section) + deep links
 * to the live full-page surfaces. The homepage's other section components (Hero,
 * ProductGrid, MeetEmma, ...) are module-private to StorefrontHome.tsx; they are
 * reviewed as full-page screenshots via their real route (`/`), not re-mounted
 * here. Exporting them for an in-gallery mount is a deliberate future (v2
 * gallery) step, not freelanced now.
 *
 * This is a reference sheet, not a customer viewport, so it intentionally shows
 * every token at once (the coral-budget "one per viewport" rule governs shipped
 * pages, not a swatch board).
 *
 * RR7: data flows loader -> useLoaderData only; no useEffect fetching. The
 * server-only discovery import stays behind the loader.
 */

import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getDiscoveryIndex } from '~/lib/discovery.server'
import { getSensationMapData } from '~/lib/sensation-map.server'
import type { DiscoveryProduct } from '~/types/discovery'
import type { SensationDialV2 } from '~/types'
import { StorefrontProductCard } from '~/components/store/StorefrontProductCard'
import { SensationDial } from '~/components/store/SensationDial'
import { SensationMap } from '~/components/store/SensationMap'
import { EmailSubscribe } from '~/components/store/EmailSubscribe'
import { Reveal } from '~/components/motion/Reveal'

export const meta: MetaFunction = () => [{ title: 'Design Gallery · xdipx Admin' }]

/** Cold-index fallback so the gallery always renders card specimens to
 *  screenshot even when KV is empty in a fresh env. Null images render the
 *  card's sage ♥ placeholder tile — honest and self-contained. */
const FIXTURE_SPECIMENS: DiscoveryProduct[] = [
  { id: 'fixture-1', handle: 'sample-product-one', title: 'Sample product, the considered pick', defaultVariantId: null, price: 68, priceMax: null, compareAtPrice: 96, colorValues: [], sizeValues: [], imageUrl: null, imageAlt: null, category: 'Pleasure', subcategory: 'Vibrators', mood: [], audience: [], matters: [], totalInventory: null, productType: null, productTypeDial: 'vibrator' },
  { id: 'fixture-2', handle: 'sample-product-two', title: 'Sample product, the quiet everyday', defaultVariantId: null, price: 42, priceMax: null, compareAtPrice: null, colorValues: [], sizeValues: [], imageUrl: null, imageAlt: null, category: 'Body', subcategory: 'Lubricants', mood: [], audience: [], matters: [], totalInventory: null, productType: null, productTypeDial: 'lube' },
  { id: 'fixture-3', handle: 'sample-product-three', title: 'Sample product, for two', defaultVariantId: null, price: 120, priceMax: 155, compareAtPrice: null, colorValues: [], sizeValues: [], imageUrl: null, imageAlt: null, category: 'Play', subcategory: 'Couples', mood: [], audience: [], matters: [], totalInventory: null, productType: null, productTypeDial: 'couples' },
  { id: 'fixture-4', handle: 'sample-product-four', title: 'Sample product, to wear', defaultVariantId: null, price: 54, priceMax: null, compareAtPrice: 72, colorValues: [], sizeValues: [], imageUrl: null, imageAlt: null, category: 'Wear', subcategory: 'Lingerie', mood: [], audience: [], matters: [], totalInventory: null, productType: null, productTypeDial: 'wear' },
]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  // Real product specimens for the card section. Deterministic slice (sorted by
  // handle, first eight with images) so screenshots stay stable within the
  // cache window; falls back to the fixture on a cold index so the page never
  // renders blank card frames.
  const index = await getDiscoveryIndex().catch(() => [] as DiscoveryProduct[])
  const specimens = index
    .filter(p => p.imageUrl)
    .sort((a, b) => a.handle.localeCompare(b.handle))
    .slice(0, 8)

  // Live Sensation Map instrument data so the gallery is an isolated review /
  // screenshot surface for it too (degrades to null on a cold index).
  const sensationMap = await getSensationMapData().catch(() => null)

  const resolved = specimens.length ? specimens : FIXTURE_SPECIMENS
  return {
    specimens: resolved,
    sampleHandle: resolved[0]?.handle ?? 'best-sellers',
    fromFixture: specimens.length === 0,
    sensationMap,
  }
}

/* ─── Shared token constants (mirror app.css @theme + docs/design-doctrine.md) ─ */

const MONO = { fontFamily: 'var(--font-mono)' } as const
const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 400 } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

interface Token { name: string; value: string; use: string; className: string; dark?: boolean; border?: boolean }

const SURFACE_TOKENS: Token[] = [
  { name: 'paper', value: '#FFFFFF', use: 'Page background, primary surface', className: 'bg-paper', border: true },
  { name: 'paper-2', value: '#FAFAF9', use: 'Secondary surface, card backs', className: 'bg-paper-2', border: true },
  { name: 'paper-3', value: '#F4F3F1', use: 'Tertiary surface', className: 'bg-paper-3', border: true },
]
const INK_TOKENS: Token[] = [
  { name: 'ink', value: '#1A1418', use: 'Primary text, dark closer band', className: 'bg-ink', dark: true },
  { name: 'ink-2', value: '#3D2F3A', use: 'Secondary dark surface', className: 'bg-ink-2', dark: true },
  { name: 'ink-3', value: '#6B5F68', use: 'Body text, metadata', className: 'bg-ink-3', dark: true },
  { name: 'ink-4', value: '#9A8F97', use: 'Fine print, numerals', className: 'bg-ink-4', dark: true },
]
const CORAL_TOKENS: Token[] = [
  { name: 'coral', value: '#FF5A36', use: 'Primary CTA, hero accent (rationed: 1/viewport)', className: 'bg-coral', dark: true },
  { name: 'coral-2', value: '#FF7A5A', use: 'Hover / secondary coral', className: 'bg-coral-2', dark: true },
  { name: 'coral-soft', value: '#FFE6DD', use: 'Full-band tint fill (not a text color)', className: 'bg-coral-soft', border: true },
]
const PLUM_TOKENS: Token[] = [
  { name: 'plum', value: '#7A2BB8', use: 'Emphasis: .em word, guided discovery', className: 'bg-plum', dark: true },
  { name: 'plum-2', value: '#5B1F8A', use: 'Pressed / active CTA', className: 'bg-plum-2', dark: true },
  { name: 'plum-soft', value: '#F3E8FB', use: 'Full-band tint fill', className: 'bg-plum-soft', border: true },
]
const ACCENT_TOKENS: Token[] = [
  { name: 'sage', value: '#7C8F78', use: 'Quiet accent: ♥ motif, tags, Emma asides', className: 'bg-sage', dark: true },
  { name: 'line', value: 'ink 8%', use: 'Hairline borders, dividers', className: 'bg-line', border: true },
  { name: 'line-2', value: 'ink 16%', use: 'Stronger dividers', className: 'bg-line-2', border: true },
  { name: 'line-3', value: 'ink 32%', use: 'Strongest dividers', className: 'bg-line-3', border: true },
]

const RADII = [
  { name: 'radius-sm', value: '8px', cls: 'rounded-[var(--radius-sm)]' },
  { name: 'radius', value: '14px', cls: 'rounded-[var(--radius)]' },
  { name: 'radius-md', value: '18px', cls: 'rounded-[var(--radius-md)]' },
  { name: 'radius-lg…4xl', value: '22px', cls: 'rounded-[var(--radius-lg)]' },
]

const MOTION_TOKENS = [
  { name: 'duration-fast', value: '150ms', use: 'Micro state changes' },
  { name: 'duration-base', value: '240ms', use: 'Standard entrance / cross-fade' },
  { name: 'duration-slow', value: '420ms', use: 'Hover image scale' },
  { name: 'ease-entrance', value: 'cubic-bezier(.22,1,.36,1)', use: 'Entrances (weighted ease-out)' },
  { name: 'ease-standard', value: 'cubic-bezier(.4,0,.2,1)', use: 'State transitions' },
  { name: 'ease-exit', value: 'cubic-bezier(.4,0,1,1)', use: 'Exits' },
  { name: 'reveal-distance', value: '16px', use: 'Max reveal travel (transform only)' },
]

const CTA_WHITELIST = ['Take a peek →', 'Show me', 'Find your fit →', "I'll take it ♥"]

const DIAL_FIXTURE: SensationDialV2 = {
  items: [
    { label: 'Intensity', value: 4 },
    { label: 'Quietness', value: 5 },
    { label: 'Softness', value: 3 },
    { label: 'Build-up', value: 2 },
  ],
}

/* ─── Layout primitives ────────────────────────────────────────────────────── */

/** One anchored, labeled section — a stable screenshot target for the harness. */
function GallerySection({
  id, kicker, title, note, children,
}: {
  id: string; kicker: string; title: string; note?: string; children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-6 rounded-2xl border border-black/5 bg-white p-5 md:p-8 shadow-sm">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-2">{kicker}</p>
          <h2 className="text-xl md:text-2xl font-semibold text-ink" style={DISPLAY}>{title}</h2>
          {note && <p className="mt-1.5 max-w-[60ch] text-sm text-ink-3" style={BODY}>{note}</p>}
        </div>
        <a href={`#${id}`} className="text-xs text-ink-4 hover:text-ink-3" style={MONO}>#{id}</a>
      </header>
      {children}
    </section>
  )
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[11px] text-ink-4" style={MONO}>{children}</p>
}

function Swatch({ token }: { token: Token }) {
  return (
    <div className="min-w-0">
      <div
        className={[
          'h-16 w-full rounded-[var(--radius-md)]',
          token.className,
          token.border ? 'border border-line-2' : '',
        ].join(' ')}
        aria-hidden="true"
      />
      <p className="mt-2 truncate text-[13px] font-medium text-ink" style={BODY}>{token.name}</p>
      <p className="text-[11px] text-ink-4" style={MONO}>{token.value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-3" style={BODY}>{token.use}</p>
    </div>
  )
}

function SwatchRow({ label, tokens }: { label: string; tokens: Token[] }) {
  return (
    <div className="mb-6 last:mb-0">
      <p className="mb-3 text-[13px] font-semibold text-ink-3" style={BODY}>{label}</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {tokens.map(t => <Swatch key={t.name} token={t} />)}
      </div>
    </div>
  )
}

/* ─── Page ─────────────────────────────────────────────────────────────────── */

export default function DesignGalleryPage() {
  const { specimens, sampleHandle, fromFixture, sensationMap } = useLoaderData<typeof loader>()

  return (
    <div className="mx-auto max-w-[1100px] pb-16">
      {/* Page header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-2">Design elevation · p1-gallery</p>
          <h1 className="text-2xl md:text-3xl font-bold text-ink" style={DISPLAY}>Design Gallery</h1>
          <p className="mt-1.5 max-w-[70ch] text-sm text-ink-3" style={BODY}>
            The v3 token system and the shipped storefront component vocabulary, isolated for review
            and screenshotting. The visual answer key for <code className="rounded bg-paper-3 px-1 py-0.5 text-[12px]">docs/design-doctrine.md</code>.
          </p>
        </div>
      </div>

      {/* Contents / jump nav */}
      <nav aria-label="Gallery contents" className="mb-6 flex flex-wrap gap-2">
        {[
          ['tokens-color', 'Color'],
          ['tokens-type', 'Type'],
          ['tokens-radii-motion', 'Radii & motion'],
          ['components-cards', 'Product cards'],
          ['components-chrome', 'Chrome & CTAs'],
          ['components-sensation-dial', 'Sensation dial'],
          ['components-sensation-map', 'Sensation Map'],
          ['surfaces', 'Live surfaces'],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[13px] text-ink-3 hover:border-black/20 hover:text-ink" style={BODY}>
            {label}
          </a>
        ))}
      </nav>

      {fromFixture && (
        <p className="mb-6 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-[13px] text-amber-800" style={BODY}>
          Discovery index is cold in this environment. Product-card specimens use inline fixtures
          (♥ placeholder tiles). Warm the index to see real product imagery.
        </p>
      )}

      <div className="space-y-6">
        {/* ── Color ───────────────────────────────────────────────────────── */}
        <GallerySection
          id="tokens-color"
          kicker="Doctrine §3"
          title="Color — coral is the accent, plum is emphasis"
          note="v3 token names only (paper / ink / coral / plum / sage). No gradients, no reintroduced orange, no old-cream backgrounds. Coral is rationed to one primary element per shipped viewport."
        >
          <SwatchRow label="Surfaces" tokens={SURFACE_TOKENS} />
          <SwatchRow label="Ink ramp (type + dark band)" tokens={INK_TOKENS} />
          <SwatchRow label="Coral (primary action)" tokens={CORAL_TOKENS} />
          <SwatchRow label="Plum (emphasis)" tokens={PLUM_TOKENS} />
          <SwatchRow label="Accent & lines" tokens={ACCENT_TOKENS} />
        </GallerySection>

        {/* ── Type ────────────────────────────────────────────────────────── */}
        <GallerySection
          id="tokens-type"
          kicker="Doctrine §2"
          title="Type — Newsreader / DM Sans / JetBrains Mono"
          note="Three families, each one job. The one-word italic-plum .em emphasis is earned, exactly one per headline. Reuse these sizes; do not freestyle."
        >
          <div className="space-y-8">
            <div>
              <p className="kicker mb-2">Nº 01, this week's pick</p>
              <h3 className="text-[2.7rem] leading-[1.04] tracking-[-0.015em] text-ink md:text-[4.4rem]" style={{ fontFamily: 'var(--font-display)', fontWeight: 450 }}>
                Pleasure, worth getting <em className="em">right</em>.
              </h3>
              <Caption>Hero H1 · text-[2.7rem] md:text-[4.4rem] · leading 1.04 · Newsreader 450</Caption>
            </div>
            <div>
              <h3 className="text-[1.9rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.9rem]" style={DISPLAY}>
                Most picked, <em className="em">right now</em>.
              </h3>
              <Caption>Section H2 · text-[1.9rem] md:text-[2.9rem] · leading 1.1</Caption>
            </div>
            <div>
              <h3 className="text-[1.5rem] text-ink md:text-[1.7rem]" style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}>
                Chosen for how they feel.
              </h3>
              <Caption>Sub-heading / tile label H3 · text-[1.5rem]–[1.7rem]</Caption>
            </div>
            <div>
              <p className="max-w-[60ch] text-[16.5px] leading-relaxed text-ink-3" style={BODY}>
                A short, checked selection instead of a wall of options. Body copy runs 16 to 16.5px,
                leading-relaxed, ink-3, and never wider than about sixty characters per measure so the
                eye keeps its line.
              </p>
              <Caption>Body · 16–16.5px · leading-relaxed · text-ink-3 · max ~60ch</Caption>
            </div>
            <div className="flex flex-wrap items-center gap-8">
              <div>
                <p className="kicker">Where to begin</p>
                <Caption>Kicker / eyebrow · .kicker (mono, uppercase, 0.18em)</Caption>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>Nº 05</p>
                <Caption>Numeral motif · mono · ink-4 · tracking 0.18em</Caption>
              </div>
              <div>
                <p className="text-[1.9rem] italic leading-[1.16] text-ink md:text-[2.4rem]" style={{ fontFamily: 'var(--font-display)', fontWeight: 450 }}>
                  <span className="mr-1 not-italic text-coral" aria-hidden="true">♥</span>
                  A pull-quote is typographic art.
                </p>
                <Caption>Pull-quote · italic Newsreader at display scale (Meet Emma)</Caption>
              </div>
            </div>
          </div>
        </GallerySection>

        {/* ── Radii & motion ─────────────────────────────────────────────── */}
        <GallerySection
          id="tokens-radii-motion"
          kicker="Doctrine §3 · §5"
          title="Radii & motion"
          note="Everything ≥ lg is 22px. Motion is the editorial reveal: transform/opacity only, zero CLS, one heartbeat per page, reduced-motion renders the final state."
        >
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {RADII.map(r => (
              <div key={r.name}>
                <div className={`h-16 w-full border border-line-2 bg-paper-3 ${r.cls}`} aria-hidden="true" />
                <p className="mt-2 text-[13px] font-medium text-ink" style={BODY}>{r.name}</p>
                <p className="text-[11px] text-ink-4" style={MONO}>{r.value}</p>
              </div>
            ))}
          </div>

          <div className="mb-8 overflow-x-auto -mx-5 px-5 md:mx-0 md:px-0">
            <table className="w-full min-w-[520px] text-left text-[13px]" style={BODY}>
              <thead>
                <tr className="border-b border-line-2 text-ink-4">
                  <th className="py-2 pr-4 font-medium">Token</th>
                  <th className="py-2 pr-4 font-medium">Value</th>
                  <th className="py-2 font-medium">Use</th>
                </tr>
              </thead>
              <tbody>
                {MOTION_TOKENS.map(m => (
                  <tr key={m.name} className="border-b border-line">
                    <td className="py-2 pr-4 text-ink" style={MONO}>{m.name}</td>
                    <td className="py-2 pr-4 text-ink-3" style={MONO}>{m.value}</td>
                    <td className="py-2 text-ink-3">{m.use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <p className="mb-3 text-[13px] font-semibold text-ink-3" style={BODY}>Reveal variants (animate once on view, settle to final state)</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(['fade', 'up', 'scale'] as const).map(v => (
                <Reveal key={v} variant={v}>
                  <div className="grid h-24 place-items-center rounded-[var(--radius-lg)] border border-line bg-paper-2 text-ink-3" style={BODY}>
                    variant="{v}"
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </GallerySection>

        {/* ── Product cards ──────────────────────────────────────────────── */}
        <GallerySection
          id="components-cards"
          kicker="Doctrine §6"
          title="Product cards — the considered set"
          note="StorefrontProductCard consumes the lean DiscoveryProduct shape. Grid = 2-up mobile / 4-up desktop, hairline-framed. Rail = 220px snap cards. Contrast between the two gives the page rhythm."
        >
          <p className="mb-3 text-[13px] font-semibold text-ink-3" style={BODY}>Grid (fluid, 2-up → 4-up)</p>
          <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
            {specimens.slice(0, 4).map((p, i) => (
              <StorefrontProductCard key={p.id} product={p} fluid priority={i === 0} />
            ))}
          </div>

          <p className="mb-3 text-[13px] font-semibold text-ink-3" style={BODY}>Rail (220px, horizontal snap)</p>
          <div className="-mx-5 flex snap-x gap-[18px] overflow-x-auto px-5 pb-2 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
            {specimens.map(p => (
              <div key={p.id} className="w-[220px] shrink-0 snap-start">
                <StorefrontProductCard product={p} />
              </div>
            ))}
          </div>
        </GallerySection>

        {/* ── Chrome & CTAs ──────────────────────────────────────────────── */}
        <GallerySection
          id="components-chrome"
          kicker="Doctrine §6 · voice charter"
          title="Chrome & CTAs"
          note="Rounded-full 22px CTAs: one coral primary, one ghost secondary. Labels from the voice whitelist only, never 'Buy now', never the same label twice. The ♥ motif lives in CTA labels and Emma asides only."
        >
          <p className="mb-3 text-[13px] font-semibold text-ink-3" style={BODY}>CTA whitelist</p>
          <div className="mb-8 flex flex-wrap items-center gap-3">
            {CTA_WHITELIST.map((label, i) => (
              <span
                key={label}
                className={[
                  'inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-[15px] font-medium transition-transform hover:-translate-y-0.5',
                  i === 0 ? 'bg-coral text-white' : 'border border-line-2 text-ink hover:border-ink-3',
                ].join(' ')}
                style={BODY}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="mb-8 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-3 text-[13px] font-semibold text-ink-3" style={BODY}>Numeral motif</p>
              <span className="text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>Nº 03</span>
            </div>
            <div>
              <p className="mb-3 text-[13px] font-semibold text-ink-3" style={BODY}>Emma aside</p>
              <p className="text-[1.05rem] italic text-sage" style={DISPLAY}>
                ♥ Picked for pacing and material, not just power.
              </p>
            </div>
            <div>
              <p className="mb-3 text-[13px] font-semibold text-ink-3" style={BODY}>Coral hairline link (.link-coral)</p>
              <a href="#components-chrome" className="text-[15px] font-medium text-ink link-coral" style={BODY}>See all →</a>
            </div>
            <div>
              <p className="mb-3 text-[13px] font-semibold text-ink-3" style={BODY}>Trust strip row</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {['Ships in plain packaging', 'Billed as XDIPX', '30-day returns'].map(t => (
                  <span key={t} className="flex items-center gap-2 text-[13.5px] text-ink-3" style={BODY}>
                    <span className="text-sage" aria-hidden="true">♥</span> {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <p className="mb-3 text-[13px] font-semibold text-ink-3" style={BODY}>Email capture (EmailSubscribe)</p>
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line">
            <EmailSubscribe
              heading="Good taste, delivered quietly."
              subcopy="Emma's picks, on an irregular schedule. Discreet, direct."
              buttonLabel="I'm in ♥"
            />
          </div>
        </GallerySection>

        {/* ── Sensation dial (PDP) ───────────────────────────────────────── */}
        <GallerySection
          id="components-sensation-dial"
          kicker="PDP component"
          title="Sensation dial — how it feels"
          note="The read-only PDP instrument (SensationDial) that renders the per-dimension sensation rating as coral bars. Distinct from the interactive homepage Sensation Map."
        >
          <SensationDial type="vibrator" valuesV2={DIAL_FIXTURE} />
        </GallerySection>

        {/* ── Sensation Map (homepage Nº 07) ─────────────────────────────── */}
        <GallerySection
          id="components-sensation-map"
          kicker="Homepage Nº 07 · live"
          title="The Sensation Map"
          note="The interactive discovery instrument wired into the storefront homepage. Turn a Type or Feel dial and the result cards cross-fade to real PDPs (via /api/sensation-map). Ground is plum-soft; the selected Type notch is the one coral element."
        >
          {sensationMap?.defaultState && sensationMap.defaultMatch ? (
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line">
              <SensationMap
                types={sensationMap.types}
                feels={sensationMap.feels}
                defaultState={sensationMap.defaultState}
                defaultMatch={sensationMap.defaultMatch}
              />
            </div>
          ) : (
            <p className="text-sm text-ink-3" style={BODY}>
              Discovery index is cold in this environment. Warm it to preview the live instrument.
            </p>
          )}
        </GallerySection>

        {/* ── Live surfaces ──────────────────────────────────────────────── */}
        <GallerySection
          id="surfaces"
          kicker="Full-page targets"
          title="Live surfaces"
          note="The full-page storefront surfaces open in their real routes for whole-page screenshots. The homepage's private section components are reviewed here, not re-mounted in this gallery."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { href: '/', label: 'Homepage (storefront variant b)', sub: '/' },
              { href: '/discover', label: 'The Compass — discovery finder', sub: '/discover' },
              { href: `/products/${sampleHandle}`, label: 'Product page (PDP)', sub: `/products/${sampleHandle}` },
              { href: '/collections/best-sellers', label: 'Collection page (PLP)', sub: '/collections/best-sellers' },
            ].map(s => (
              <a
                key={s.href}
                href={s.href}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-line bg-paper-2 px-5 py-4 transition-colors hover:border-ink-3"
              >
                <span>
                  <span className="block text-[15px] font-medium text-ink group-hover:text-plum" style={DISPLAY}>{s.label}</span>
                  <span className="block text-[12px] text-ink-4" style={MONO}>{s.sub}</span>
                </span>
                <span className="text-ink-4 group-hover:text-ink-3" aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        </GallerySection>
      </div>
    </div>
  )
}
