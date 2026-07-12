import {withImageGenerator} from '../lib/withImageGenerator'

// Notebook redesign — index-level settings (additive; blogHomepage untouched).
// Singleton doc _id: singleton.notebookSettings. Loaders fall back to
// blogHomepage / hardcoded copy when this doc doesn't exist.
export default {
  name: 'notebookSettings',
  title: 'Notebook Settings',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // singleton — no create/delete
  fields: [
    {
      name: 'kicker',
      title: 'Masthead kicker',
      type: 'string',
      description: 'Mono uppercase line above the masthead title (optional).',
    },
    ...withImageGenerator('mastheadImage'),
    {
      name: 'mastheadImageAlt',
      title: 'Masthead image alt text',
      type: 'string',
    },
    {
      name: 'newsletterHeading',
      title: 'Newsletter heading',
      type: 'string',
      description: 'Heading for the inline subscribe band on notebook pages.',
    },
    {
      name: 'newsletterBody',
      title: 'Newsletter body',
      type: 'text',
      rows: 2,
      description: 'One or two short sentences under the newsletter heading.',
    },
    {
      name: 'newsletterButtonLabel',
      title: 'Newsletter button label',
      type: 'string',
      description: 'Submit button label. Keep it warm, no urgency.',
    },
  ],
  preview: {prepare: () => ({title: 'Notebook Settings'})},
}
