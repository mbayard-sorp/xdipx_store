/**
 * castMember — "friends of Emma": the recurring, diverse cast of AI presenters
 * for the social video pipeline (xdipx's influencer army). ADDITIVE doc type;
 * the editor (Emma) singleton is untouched and remains the canonical Emma.
 *
 * Governance: a character is usable by the video pipeline ONLY when active AND
 * approvedForUse are both true. approvedForUse starts false so every look gets
 * the owner's explicit sign-off before it ever appears in a generated frame.
 * Cast members are scene presence and presenters; they may voice aggregated
 * review-pattern language ("reviewers describe...") but never fabricated
 * personal testimony, and every video featuring one carries the AI disclosure.
 */

export default {
  name: 'castMember',
  title: 'Cast Member (Friend of Emma)',
  type: 'document',

  fields: [
    {
      name: 'name',
      title: 'First name',
      type: 'string',
      description: 'First name only, matching how Emma is presented.',
      validation: Rule => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'name', maxLength: 40 },
      description: 'Used as friend:{slug} by the video pipeline.',
      validation: Rule => Rule.required(),
    },
    {
      name: 'role',
      title: 'Role',
      type: 'string',
      initialValue: 'Friend of Emma',
      description: 'Relationship framing shown in admin (never a job title implying real employment).',
    },
    {
      name: 'referencePhoto',
      title: 'Reference photo',
      type: 'image',
      description: 'Canonical photorealistic portrait. The video pipeline passes this as the character reference for every scene frame, so consistency across videos depends on it staying stable.',
      validation: Rule => Rule.required(),
    },
    {
      name: 'photoAlt',
      title: 'Photo alt text',
      type: 'string',
      validation: Rule => Rule.required(),
    },
    {
      name: 'shortBio',
      title: 'Short bio',
      type: 'text',
      rows: 3,
      description: 'One to two sentences of persona flavor for admin context. Never shown as a customer testimonial.',
      validation: Rule => Rule.max(280),
    },
    {
      name: 'personaNotes',
      title: 'Persona notes (prompting)',
      type: 'text',
      rows: 4,
      description: 'Vibe, energy, wardrobe leanings, and voice notes the video-producer folds into scene and script prompts.',
    },
    {
      name: 'active',
      title: 'Active',
      type: 'boolean',
      initialValue: true,
      description: 'Per-character kill switch. Off = the pipeline refuses this presenter.',
    },
    {
      name: 'approvedForUse',
      title: 'Approved for use',
      type: 'boolean',
      initialValue: false,
      description: 'Owner sign-off on this exact look. Stays OFF until Mike confirms; the pipeline hard-fails on unapproved characters rather than substituting Emma.',
    },
  ],

  preview: {
    select: { title: 'name', subtitle: 'role', media: 'referencePhoto', approved: 'approvedForUse' },
    prepare({ title, subtitle, media, approved }) {
      return { title: `${title}${approved ? '' : ' (awaiting approval)'}`, subtitle, media }
    },
  },
}
