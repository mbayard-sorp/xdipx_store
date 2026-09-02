/**
 * Who is allowed to interrupt the owner, and through which channel.
 *
 * ## Why this file exists
 *
 * `operating-system.md` §5 has always said the owner should be paged for a
 * handful of things and merely *informed* about the rest. It failed, and the
 * reason is worth being precise about: **five was not the wrong number, nothing
 * enforced it.** Twenty-eight call sites across seventeen modules each decided
 * for themselves whether the owner needed an email, and every one of them
 * concluded yes. A prose rule with no mechanism is a preference.
 *
 * So the rule is data here, and the mechanism is the type system plus the
 * sender, not a lint someone has to remember to run.
 *
 * ## Three channels, and only one of them reaches a phone
 *
 * - **`page`** — the money path is down or the storefront is down. Email AND
 *   SMS, at any hour. Exactly two classes qualify, by owner decision.
 * - **`queue`** — real, owner-owned, and not urgent. Suppressed once
 *   `owner_queue_enabled` is on, because `computeOwnerQueue()` renders it from
 *   the same underlying rows (blockers, tickets, PRs) that the email was
 *   summarising. The information is not lost; the interruption is.
 * - **`lane`** — not the owner's at all. A team's own floor breached, or a
 *   detector fired. It files a ticket at `laneTeam` instead. Invariant 3 of the
 *   self-healing program: a breach files at the owning lane, never at the
 *   owner's inbox.
 *
 * ## `sendOwnerSms` takes only a paging class, by type
 *
 * `PagingClass` is a two-member union, so handing SMS anything else is a
 * compile error rather than a review note. That is deliberate and it has a
 * specific target: `log-monitor` held an SMS hook, and this program measured
 * that its classifier produced **zero tickets in its entire lifetime** while
 * faithfully classifying npm-install lines. A channel demonstrated to be
 * reading the wrong feed must not be able to reach a phone at 3am. It can earn
 * the pager back when the feed is fixed, by which point adding a class here is
 * a deliberate, reviewable act.
 *
 * ## Nothing here changes behaviour on its own
 *
 * Suppression is gated on `owner_queue_enabled`, default off. Until that valve
 * flips, every `queue` and `lane` class still sends exactly as it does today.
 * This file establishes the vocabulary and the enforcement; the traffic
 * reduction arrives with the queue that replaces it.
 */

export type EscalationChannel = 'page' | 'queue' | 'lane'

export interface EscalationClass {
  /** Why this class exists, and why it sits in the channel it does. */
  why: string
  channel: EscalationChannel
  /** For `lane` classes: the team whose queue absorbs this instead of the owner. */
  laneTeam?: string
}

/**
 * The two classes permitted to reach a phone.
 *
 * A union type rather than a runtime check, so `sendOwnerSms` cannot be handed
 * anything else without failing `tsc`.
 */
export type PagingClass = 'money-path-down' | 'storefront-down'

export const PAGING_CLASSES: readonly PagingClass[] = ['money-path-down', 'storefront-down']

export const ESCALATION_CLASSES = {
  // --- page: email + SMS, any hour -----------------------------------------
  'money-path-down': {
    channel: 'page',
    why:
      'A customer cannot pay, or a payment happened and the system did not notice. The checkout '
      + 'probe, the purchase watcher, and the order-created webhook. This is the only domain the '
      + 'owner reserved that also has a real-time failure mode.',
  },
  'storefront-down': {
    channel: 'page',
    why:
      'A visitor sees a broken or empty storefront. The homepage healthcheck, which also owns the '
      + 'rollback to last-good. One of only two crons whose failure a visitor experiences directly.',
  },

  // --- queue: real owner work, rendered rather than sent --------------------
  'protected-merge': {
    channel: 'queue',
    why:
      'A PR touches a protected path and needs the owner\'s merge. Previously one email PER PR, '
      + 'which is how 35 needs-owner PRs in 14 days became 35 interruptions for what is one list.',
  },
  'engine-down': {
    channel: 'queue',
    why:
      'The release engine failed its own self-check, so no agent PR can merge. Serious, but the '
      + 'remedy is a config fix and not a 3am one. The GitHub token expiring in July took two days '
      + 'to notice, which is what the daily queue fixes without needing a pager.',
  },
  'ci-stuck': {
    channel: 'queue',
    why: 'GitHub will not produce a required check and the re-trigger budget is spent.',
  },
  'ticket-exhausted': {
    channel: 'queue',
    why: 'A ticket failed MAX_TICKET_ATTEMPTS times and needs a human read.',
  },
  'blocker-list': {
    channel: 'queue',
    why:
      'The owner blocker list itself. Becomes a section of the queue rather than its own 13:30 '
      + 'email. NOTE: only the SEND is suppressed; /cron/blocker-list keeps running, because '
      + 'verifyBlockers() has exactly one caller chain and it ends there, so deleting the cron '
      + 'would delete the only thing that evaluates probes and auto-clears rows.',
  },
  'owner-decision': {
    channel: 'queue',
    why:
      'A promo code to mint, a campaign to send, an import batch to approve — work that is '
      + 'structurally the owner\'s because it spends money or carries brand risk.',
  },
  'pricing-report': {
    channel: 'queue',
    why: 'The daily pricing summary. Informational; a real pricing failure is money-path-down.',
  },
  'seo-report': {
    channel: 'queue',
    why:
      'The daily SEO regression tripwire and aggregate. Informational: a failed canonical or a '
      + 'stray noindex is real, but it is a next-day fix, not a 3am one.',
  },
  'content-health': {
    channel: 'queue',
    why: 'Notebook render checks and similar content-surface health.',
  },
  'inbox': {
    channel: 'queue',
    why: 'An inbound reply on the outreach lane that wants a human answer.',
  },
  'daily-digest': {
    channel: 'queue',
    why:
      'The digest itself: the one legitimate scheduled send, and the surface every other class '
      + 'here folds into. Classed `queue` rather than `page` because a late digest is not an '
      + 'incident — but a MISSING one is, and that is why /cron/owner-digest is a recorded cron '
      + 'with its own liveness floor.',
  },

  // --- lane: a team's problem, filed at that team ---------------------------
  'ci-red-main': {
    channel: 'lane',
    laneTeam: 'strategy',
    why:
      'The default branch is red, so every open PR is red. Real and urgent, but the actor is the '
      + 'dev lane, not the owner. Detection latency here already exceeds remedy latency: a '
      + '10-minute poll cannot beat a multi-minute Actions run whose fix is a multi-minute deploy.',
  },
  'import-health': {
    channel: 'lane',
    laneTeam: 'product',
    why: 'The enrich-to-publish chain stalled or produced nothing. The product lane owns it.',
  },
} as const satisfies Record<string, EscalationClass>

export type EscalationClassName = keyof typeof ESCALATION_CLASSES

export const ESCALATION_CLASS_NAMES = Object.keys(ESCALATION_CLASSES) as EscalationClassName[]

export function escalationChannel(name: EscalationClassName): EscalationChannel {
  return ESCALATION_CLASSES[name].channel
}

/** The team a `lane` class files at, or null for every other channel. */
export function escalationLaneTeam(name: EscalationClassName): string | null {
  const c = ESCALATION_CLASSES[name] as EscalationClass
  return c.channel === 'lane' ? (c.laneTeam ?? null) : null
}

/**
 * True when this class may interrupt the owner regardless of the queue valve.
 *
 * The runtime companion to the `PagingClass` type: `tsc` stops a bad SMS at the
 * call site, and this stops a bad *email* suppression at the sender, so a
 * paging class is never silently swallowed by a valve flip.
 */
export function isPagingClass(name: string): name is PagingClass {
  return (PAGING_CLASSES as readonly string[]).includes(name)
}

export function isEscalationClass(name: string): name is EscalationClassName {
  return Object.prototype.hasOwnProperty.call(ESCALATION_CLASSES, name)
}
