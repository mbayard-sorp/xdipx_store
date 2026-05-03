/**
 * app/lib/sms-v2/templates/category-explainers.ts
 *
 * Emma-voice category education entries for the discovery engine.
 * Surfaces when a customer asks what a category is or seems unfamiliar.
 *
 * Two variants per category:
 *   - sms: under ~450 chars, single paragraph, no Markdown.
 *   - chat: richer, may use Markdown bold and line breaks for web display.
 *
 * Voice rules (from CLAUDE.md + Emma persona):
 *   - Emma is a trusted friend who tests everything she recommends.
 *   - Suggestive is fine, explicit is not.
 *   - Never "sex" as adjective. Use "intimate", "pleasure", "wellness", "satisfaction".
 *   - No em-dashes. Use commas, periods, or hyphens in compounds.
 *   - No countdowns, no "buy now".
 *   - Price never closes a message.
 *   - Brand is "XDIPX" (pronounced "ex-dip-ex").
 */

export type ExplainerCategory = 'lube' | 'vibrator' | 'dildo' | 'plug' | 'wand' | 'wear'

export interface CategoryExplainerEntry {
  category: ExplainerCategory
  /** SMS variant: under ~450 chars. */
  sms: string
  /** Web variant: can be richer with line breaks; bullet/bold use Markdown. */
  chat: string
}

export const CATEGORY_EXPLAINERS: ReadonlyArray<CategoryExplainerEntry> = [
  {
    category: 'lube',
    sms:
      "There are four main types. Water-based is the all-rounder, safe with everything, easy to clean. Silicone lasts longer but can't be used with silicone toys. Hybrid is the middle ground. Warming or sensation lubes add a stimulating feeling, love them or hate them. Want me to point you at a couple in whichever direction sounds right?",
    chat:
      "Okay, lube is actually one of my favorite things to talk people through, because if you've never bought it before, it feels like there should be a quiz you're supposed to have taken first. There isn't. Here's the quick version:\n\n**Water-based** is the everyday workhorse. Plays nice with every toy, every material, super easy to clean. Best starting point if you're not sure.\n\n**Silicone** lasts longer and feels silkier, which is great for sex when you need staying power, or for shower play. One catch: don't use it with silicone toys, it can break down the material.\n\n**Hybrid** splits the difference. A little of both. Good if you want something more luxurious than water-based but don't want to worry as much about toy compatibility.\n\n**Warming or sensation** lubes add a heating or tingling effect. Some people love it, some find it too intense. Worth trying once if you're curious.\n\nIf you've never bought lube before, this is the easy part. You're not doing it wrong. Which direction sounds right for what you're working with?",
  },
  {
    category: 'vibrator',
    sms:
      "Three main shapes. Bullets and small clitoral toys are precise and quiet, great if you want something discreet. Wands are the powerful ones, big motor, deep rumble, often the 'first orgasm in years' pick. Rabbits and dual-stim toys do internal and external at the same time. If you try one and it doesn't click, that's information, not failure. What feels closest to what you're after?",
    chat:
      "Vibrators come in three main shapes, and which one's right depends on what you actually want to feel.\n\n**Bullets and small clitoral toys** are precise and quiet. Discreet, easy to travel with, great as a first vibe or as a partner-play addition.\n\n**Wands** are the powerful ones. Big motor, deep rumble. Most people who haven't had a clitoral orgasm before find one with a wand. They're a little less discreet but the trade-off is real.\n\n**Rabbits and dual-stim toys** hit internal and external at the same time. Combination play, more involved.\n\nThis is doing its job when you're getting where you want to be without having to work for it. If it's not feeling right, it's the wrong shape for you yet, that's not on you. What feels closest to what you're after?",
  },
  {
    category: 'dildo',
    sms:
      "Big spectrum here. Glass and stainless feel firm and weighty, perfect with temperature play. Silicone is soft and flexible, more body-like. Sizes range from beginner-friendly slim to 'definitely work up to it.' If a size feels like too much, it is, that's the toy not fitting you. Is this your first or are you adding to the rotation?",
    chat:
      "Dildos cover a wide range and the right one depends on a few things.\n\n**Material** is the first split. Silicone is soft, flexible, and warms to body temperature, which feels closer to a real partner. Glass and stainless steel are firm and weighty, and they hold temperature, so they're great for warming or cooling play.\n\n**Size** matters more than you'd think. A size that feels comfortable to one person can be too much or not enough for another. If it's a first dildo or a first time exploring vaginal or anal play, starting on the slimmer side and working up is the move.\n\n**Shape** comes last but matters too. Some have curves designed for G-spot or prostate play; some are straighter and more versatile.\n\nIf a size or shape doesn't feel right once you try it, that's the toy not fitting you, not the other way around. Is this your first one, or are you adding to a collection?",
  },
  {
    category: 'plug',
    sms:
      "A few directions for anal play. Beginner sets step you up gradually so nothing's a surprise. Weighted metal or glass gives a fuller sensation and is easy to clean. Vibrating plugs add a buzz. Jewelry-style plugs are more about the look. Rule of thumb: if anything ever feels like too much, it is, back off and that's the right call. Any of those sound like the right speed?",
    chat:
      "Plugs split into a few directions, and the right one depends on experience level and what you're after.\n\n**Beginner sets** step you up through three or four sizes gradually, so nothing surprises the body. Best starting point for first-time anal play.\n\n**Weighted metal or glass** gives a fuller, more present sensation. Easy to clean, holds temperature, lasts forever.\n\n**Vibrating plugs** add a buzz, sometimes app-controlled, often used for partner play or solo with a vibrator.\n\n**Jewelry-style plugs** are more about the look than novel sensation. Decorative gems on the base.\n\nRule of thumb: if anything feels like too much, it is. Back off and that's the right call, never push past comfort. Any of those sound like the right speed for what you're thinking?",
  },
  {
    category: 'wand',
    sms:
      "Wand world is split between corded (Magic Wand classic, serious power, plug-it-in) and rechargeable (lighter, takes-it-anywhere). Some have flexible heads, some come with attachments for internal play. Most people use them clitorally first. If the power's too much on direct contact, a layer of fabric is the move, that's normal. Looking for raw power or portability?",
    chat:
      "The wand category splits along two axes.\n\n**Corded vs. rechargeable.** The Magic Wand classic is corded and the gold standard for raw power. Rechargeable wands are lighter and travel well, often quieter, sometimes nearly as powerful.\n\n**Head shape and attachments.** Some wands have flexible heads that bend with body contour. Most can take attachments, including ones that turn the wand into an internal toy.\n\nIf 'I want serious power' is the brief, corded. If 'I want to take this on a trip' is the brief, rechargeable. Most people use wands clitorally first, and if direct contact is too much, a pillow or layer of fabric between is normal, that's not a sign anything's wrong with you or the toy. Which one sounds closer to what you need?",
  },
  {
    category: 'wear',
    sms:
      "Big range. Lingerie sets (bra, panty, sometimes garter), bodysuits and teddies (one piece, super flattering), bodystockings (sheer top to toe), and costume-leaning pieces if you want to play a role. Sizing varies a lot by brand, no universal fit, that's the industry not your body. Any vibe you're going for, soft and romantic or a little more daring?",
    chat:
      "The wear category covers a lot of ground.\n\n**Lingerie sets** are the classic split: bra, panty, sometimes a garter. Pretty, flexible, mix-and-match.\n\n**Bodysuits and teddies** are one-piece, often more flattering across body shapes, faster to put on, no garter clips to wrestle with.\n\n**Bodystockings** are sheer head-to-toe. Bold look, surprisingly forgiving fit because there's no rigid sizing.\n\n**Costume-leaning pieces** lean into role-play, more theatrical.\n\nIf a piece doesn't fit when it shows up, that's the brand's sizing, not your body. The industry is wildly inconsistent, we'll find one that works. Any vibe you're going for? Soft and romantic, bold and a little dramatic, or somewhere in between?",
  },
]

/**
 * Look up the explainer entry for a given category.
 * Returns undefined if the category is not in the bank (should not happen in practice).
 */
export function getExplainer(category: ExplainerCategory): CategoryExplainerEntry | undefined {
  return CATEGORY_EXPLAINERS.find((e) => e.category === category)
}
