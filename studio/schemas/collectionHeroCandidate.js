// A generated collection hero waiting for owner review on
// /admin/collections-review (collections audit 2026-10-23).
//
// The image itself lives in Shopify Files (imageUrl); this document only
// carries the review state. Approving one sets it as the collection's Shopify
// image. Written by the generation script and the review page, not by hand.
export default {
  name: 'collectionHeroCandidate',
  title: 'Collection hero candidate',
  type: 'document',
  fields: [
    { name: 'collectionHandle', title: 'Collection handle', type: 'string', validation: (Rule) => Rule.required() },
    { name: 'imageUrl', title: 'Image URL (Shopify Files)', type: 'url', validation: (Rule) => Rule.required() },
    { name: 'alt', title: 'Alt text', type: 'string' },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      initialValue: 'candidate',
      options: {
        list: [
          { title: 'Waiting for review', value: 'candidate' },
          { title: 'Approved (live)', value: 'approved' },
          { title: 'Rejected', value: 'rejected' },
          { title: 'Redo requested', value: 'redo' },
          { title: 'Superseded', value: 'superseded' },
        ],
        layout: 'radio',
      },
      validation: (Rule) => Rule.required(),
    },
    { name: 'note', title: 'Owner note', type: 'text', rows: 3 },
    { name: 'batch', title: 'Batch', type: 'string', description: 'e.g. "pilot-2026-10-24".' },
    { name: 'story', title: 'Scene story', type: 'text', rows: 2 },
    { name: 'prompt', title: 'Prompt', type: 'text', rows: 4 },
    { name: 'model', title: 'Model', type: 'string' },
    { name: 'castSlugs', title: 'Cast', type: 'array', of: [{ type: 'string' }] },
    { name: 'productHandles', title: 'Featured products', type: 'array', of: [{ type: 'string' }] },
    { name: 'reviewedAt', title: 'Reviewed at', type: 'datetime' },
  ],
  preview: {
    select: { title: 'collectionHandle', subtitle: 'status' },
  },
}
