/**
 * FAQ content shared by the /faq page and its /faq.md markdown twin.
 * Plain data, safe to import from client and server code.
 */

export interface FaqItem {
  q: string
  a: string
}

export interface FaqSection {
  heading: string
  items: FaqItem[]
}

export const FAQ_SECTIONS: FaqSection[] = [
  {
    heading: 'Shipping & Packaging',
    items: [
      {
        q: 'Will anyone know what\'s inside?',
        a: 'Absolutely not. Every xdipx order ships in a plain, unmarked box or poly mailer. No logos, no hints, nothing. The return address will say "XD Inc." — boring on purpose.',
      },
      {
        q: 'How fast does it ship?',
        a: 'Most orders ship within 1–2 business days. Standard delivery is 3–7 business days depending on your location.',
      },
    ],
  },
  {
    heading: 'Billing',
    items: [
      {
        q: 'What will appear on my credit card statement?',
        a: 'A discreet descriptor — not xdipx. We\'ll confirm exactly what it shows in your order confirmation email.',
      },
    ],
  },
  {
    heading: 'Returns',
    items: [
      {
        q: 'What\'s your return policy?',
        a: 'Unopened items in original packaging within 30 days. Hygiene restrictions apply to used products. Something wrong? Email us at hello@xdipx.com, we\'ll make it right.',
      },
    ],
  },
  {
    heading: 'Choosing & using',
    items: [
      {
        q: 'Are these beginner-friendly?',
        a: 'Yes. Most of what Emma features is picked with first-timers in mind. Look for the lower numbers on the sensation dial and simpler controls, and tell Emma what you\'re after if you want the gentlest place to start.',
      },
      {
        q: 'What materials are body-safe?',
        a: 'Stick to non-porous, body-safe materials like medical-grade silicone, glass, and stainless steel. They don\'t trap bacteria and clean up easily. We call out the material on every product page so you always know what you\'re getting.',
      },
      {
        q: 'How do I clean and care for my product?',
        a: 'Wash before and after each use with warm water and a mild, fragrance-free soap, or a dedicated toy cleaner. Let everything dry fully before storing. Silicone, glass, and stainless steel are the easiest to keep pristine.',
      },
      {
        q: 'What kind of lubricant should I use?',
        a: 'Water-based lubricant is the safe all-rounder and works with every material. Avoid silicone-based formulas on silicone products, since they can break down the surface over time. When in doubt, water-based is the easy yes.',
      },
      {
        q: 'Are batteries or charging included?',
        a: 'Most featured products are rechargeable and ship with a USB cable. Anything that takes batteries says so right on the product page, so there are no surprises.',
      },
    ],
  },
  {
    heading: 'About xdipx',
    items: [
      {
        q: 'What does xdipx mean?',
        a: 'It\'s a palindrome. Reads the same forwards and backwards. Just like our products: built for everyone, from every angle. ♥',
      },
      {
        q: 'How do Emma\'s picks work?',
        a: 'Emma features one product at a time, chosen by hand and marked down to a price we\'ve negotiated. No countdown, no code. When she moves on to her next pick, the earlier one stays shoppable in the vault. The price you see is the price.',
      },
      {
        q: 'Do you share my information?',
        a: 'Never. Your privacy is paramount. We use your email only to send deal notifications if you opt in. Full details in our Privacy Policy.',
      },
    ],
  },
]
