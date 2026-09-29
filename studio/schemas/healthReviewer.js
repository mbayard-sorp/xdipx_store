// E-E-A-T human expert reviewer identity (ticket #12096, tracker p2-5-eeat).
// A named real person with real, verifiable credentials who has actually
// reviewed the specific post(s) referencing them via blogPostExtras.reviewer.
// Additive: does not touch blogPost, blogAuthor, or editorialAuthor (the
// existing AI-voice-profile framework, which this is deliberately separate
// from — editorialAuthor answers "whose voice wrote this", this answers "who
// medically/factually checked this").
//
// Creating a doc here is an editorial/owner decision, not something a run
// does on its own: fabricating a reviewer identity, or attaching a real one
// to a post they did not actually review, is exactly the "fabricate proof"
// failure docs/design-doctrine.md §6 forbids. See
// docs/store-team/health-review-workflow.md for who may be a reviewer, what
// a review checks, and how attribution is recorded.
export default {
  name: 'healthReviewer',
  title: 'Health Reviewer',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {source: 'name'},
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'credentials',
      title: 'Credentials',
      type: 'string',
      description: 'Real, verifiable credentials only, e.g. "RN, AASECT-certified sex educator". Shown next to the name in the byline.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'bio',
      title: 'Bio',
      type: 'text',
      rows: 3,
      description: 'One or two sentences on background and scope of practice.',
    },
    {
      name: 'photo',
      title: 'Photo',
      type: 'image',
      options: {hotspot: true},
    },
    {
      name: 'active',
      title: 'Active',
      type: 'boolean',
      initialValue: true,
      description: 'Turn off rather than delete when a reviewer stops reviewing for xdipx; existing posts keep their historical byline.',
    },
  ],
  preview: {
    select: {title: 'name', subtitle: 'credentials'},
  },
}
