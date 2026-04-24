import { PortableText } from '@portabletext/react'
import type { PortableTextBlock } from '@portabletext/types'
import type { EditorBioBlock as EditorBioBlockType } from '~/types/cms'

interface Props {
  block: EditorBioBlockType
}

function formatPicksSince(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

const BG_CLASSES: Record<NonNullable<EditorBioBlockType['bgStyle']>, string> = {
  cream:     'bg-cream',
  paper:     'bg-paper',
  'cream-2': 'bg-cream-2',
}

export function EditorBioBlock({ block }: Props) {
  if (block.active === false) return null
  const editor = block.editor
  if (!editor?.name) return null

  const bg = BG_CLASSES[block.bgStyle ?? 'cream']
  const picksSinceLabel = formatPicksSince(editor.picksSince)
  const eyebrow = block.eyebrow ?? 'Meet the editor'

  if (block.variant === 'quote') {
    return (
      <section className={`${bg} py-12`}>
        <div className="max-w-2xl mx-auto px-4 text-center">
          <p className="text-xs uppercase tracking-wider text-sage font-semibold mb-3">
            {eyebrow}
          </p>
          {editor.shortBio ? (
            <p
              className="text-2xl md:text-3xl text-ink italic leading-relaxed mb-4"
              style={{ fontFamily: 'var(--font-script)' }}
            >
              &ldquo;{editor.shortBio}&rdquo;
            </p>
          ) : null}
          <p
            className="text-ink font-bold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            — {editor.name}
            {picksSinceLabel ? ` · editor since ${picksSinceLabel}` : ''}
          </p>
          {block.showCta ? (
            <a
              href="/"
              className="inline-block mt-6 bg-coral text-white font-bold px-6 py-3 rounded-full hover:opacity-90 transition-opacity"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              See {editor.name}&rsquo;s pick ♥
            </a>
          ) : null}
        </div>
      </section>
    )
  }

  if (block.variant === 'card') {
    return (
      <section className={`${bg} py-10`}>
        <div className="max-w-3xl mx-auto px-4">
          <div className="bg-paper border border-line rounded-[var(--radius-lg)] p-6 flex gap-5 items-start">
            {editor.photoUrl ? (
              <img
                src={editor.photoUrl}
                alt={editor.photoAlt ?? editor.name}
                className="w-20 h-20 rounded-full object-cover border-2 border-cream-2 flex-shrink-0"
                loading="lazy"
                width={80}
                height={80}
              />
            ) : null}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-sage font-semibold mb-1">
                {eyebrow}
              </p>
              <h3
                className="text-xl font-black text-ink mb-1"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {block.headingOverride ?? editor.name}
              </h3>
              <p className="text-muted text-sm mb-2">
                {editor.role}
                {picksSinceLabel ? ` · picking since ${picksSinceLabel}` : ''}
              </p>
              {editor.shortBio ? (
                <p className="text-ink/80 text-sm leading-relaxed">
                  {editor.shortBio}
                </p>
              ) : null}
              {!block.hideSocials && (editor.instagram || editor.email) ? (
                <div className="mt-3 flex gap-4 text-xs text-muted">
                  {editor.instagram ? (
                    <a href={editor.instagram} className="hover:text-coral" target="_blank" rel="noreferrer">
                      Instagram ↗
                    </a>
                  ) : null}
                  {editor.email ? (
                    <a href={`mailto:${editor.email}`} className="hover:text-coral">
                      {editor.email}
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          {block.showCta ? (
            <div className="mt-6 text-center">
              <a
                href="/"
                className="inline-block bg-coral text-white font-bold px-6 py-3 rounded-full hover:opacity-90 transition-opacity"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                See {editor.name}&rsquo;s pick ♥
              </a>
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  return (
    <section className={`${bg} py-14`}>
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex flex-col sm:flex-row gap-8 items-start mb-8">
          {editor.photoUrl ? (
            <img
              src={editor.photoUrl}
              alt={editor.photoAlt ?? editor.name}
              className="w-40 h-40 rounded-full object-cover border-4 border-cream-2 flex-shrink-0"
              loading="lazy"
              width={160}
              height={160}
            />
          ) : null}
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-sage font-semibold mb-1">
              {eyebrow}
            </p>
            <h2
              className="text-4xl font-black text-ink mb-2"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {block.headingOverride ?? editor.name}
            </h2>
            <p className="text-muted mb-3">
              {editor.role}
              {picksSinceLabel ? ` · picking since ${picksSinceLabel}` : ''}
            </p>
            {editor.shortBio ? (
              <p
                className="text-xl text-ink/90 italic leading-relaxed"
                style={{ fontFamily: 'var(--font-script)' }}
              >
                &ldquo;{editor.shortBio}&rdquo;
              </p>
            ) : null}
          </div>
        </div>

        {!block.hideLongBio && editor.longBio && (editor.longBio as unknown[]).length > 0 ? (
          <div className="prose prose-lg max-w-none text-ink/80">
            <PortableText value={editor.longBio as PortableTextBlock[]} />
          </div>
        ) : null}

        {!block.hideSocials && (editor.instagram || editor.email) ? (
          <div className="mt-6 flex gap-4 text-sm text-muted">
            {editor.instagram ? (
              <a href={editor.instagram} className="hover:text-coral" target="_blank" rel="noreferrer">
                Instagram ↗
              </a>
            ) : null}
            {editor.email ? (
              <a href={`mailto:${editor.email}`} className="hover:text-coral">
                {editor.email}
              </a>
            ) : null}
          </div>
        ) : null}

        {block.showCta ? (
          <div className="mt-8">
            <a
              href="/"
              className="inline-block bg-coral text-white font-bold px-6 py-3 rounded-full hover:opacity-90 transition-opacity"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              See {editor.name}&rsquo;s pick ♥
            </a>
          </div>
        ) : null}
      </div>
    </section>
  )
}
