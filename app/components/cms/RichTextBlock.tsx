import { PortableText } from '@portabletext/react'
import type { RichTextBlock as RichTextBlockType } from '~/types/cms'

const BG_CLASSES: Record<RichTextBlockType['bgColor'], string> = {
  white:    'bg-white',
  cream:    'bg-cream',
  mist:     'bg-cream-2',
  charcoal: 'bg-ink text-white',
  purple:   'bg-sage text-white',
}

const WIDTH_CLASSES: Record<RichTextBlockType['maxWidth'], string> = {
  narrow: 'max-w-prose',
  medium: 'max-w-4xl',
  wide:   'max-w-6xl',
}

const ptComponents = {
  block: {
    h2: ({ children }: any) => (
      <h2 className="font-display font-bold text-2xl sm:text-3xl mt-10 mb-4">{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="font-display font-semibold text-xl sm:text-2xl mt-8 mb-3">{children}</h3>
    ),
    h4: ({ children }: any) => (
      <h4 className="font-display font-semibold text-lg mt-6 mb-2">{children}</h4>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-sage pl-4 my-6 italic opacity-80">
        {children}
      </blockquote>
    ),
    normal: ({ children }: any) => (
      <p className="leading-relaxed mb-4">{children}</p>
    ),
  },
  list: {
    bullet: ({ children }: any) => <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>,
    number: ({ children }: any) => <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>,
  },
  marks: {
    strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }: any) => <em>{children}</em>,
    underline: ({ children }: any) => <span className="underline">{children}</span>,
    strikethrough: ({ children }: any) => <s>{children}</s>,
    code: ({ children }: any) => (
      <code className="bg-black/10 rounded px-1.5 py-0.5 text-sm font-mono">{children}</code>
    ),
    link: ({ children, value }: any) => (
      <a
        href={value?.href}
        target={value?.blank ? '_blank' : undefined}
        rel={value?.blank ? 'noopener noreferrer' : undefined}
        className="underline underline-offset-2 hover:opacity-70 transition-opacity"
      >
        {children}
      </a>
    ),
  },
  types: {
    image: ({ value }: any) => {
      const url = value?.asset?.url
      if (!url) return null
      return (
        <figure className="my-8">
          <img
            src={url}
            alt={value.alt ?? ''}
            loading="lazy"
            className="rounded-xl w-full"
          />
          {value.caption && (
            <figcaption className="text-sm opacity-60 mt-2">{value.caption}</figcaption>
          )}
        </figure>
      )
    },
  },
}

export function RichTextBlock({ block }: { block: RichTextBlockType }) {
  if (!block.body?.length) return null

  const bg = BG_CLASSES[block.bgColor] ?? BG_CLASSES.white
  const width = WIDTH_CLASSES[block.maxWidth] ?? WIDTH_CLASSES.narrow

  return (
    <section className={`${bg} py-10 sm:py-16 px-4`}>
      <div className={`${width} mx-auto`}>
        <PortableText value={block.body as any} components={ptComponents} />
      </div>
    </section>
  )
}
