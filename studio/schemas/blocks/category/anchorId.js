// Every merchandised page block carries an anchorId so the panel deck, email,
// and Notebook articles can deep-link straight to a shelf.
export function anchorIdField({ initialValue } = {}) {
  return {
    name: 'anchorId',
    title: 'Anchor id',
    type: 'string',
    description: 'Slug used as the block’s id, e.g. "shelf-vibrators". Deep-linkable.',
    ...(initialValue ? { initialValue } : {}),
    validation: (Rule) =>
      Rule.required()
        .max(48)
        .custom((value) =>
          !value || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
            ? true
            : 'Lowercase letters, numbers and hyphens only',
        ),
  }
}
