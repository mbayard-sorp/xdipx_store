// PDP-wide defaults singleton.
//
// Holds settings that apply to every Product Detail Page automatically (no
// per-product wiring). Today: the sitewide PDP trust bar that renders directly
// below the "I'll take it ♥" CTA. Future PDP-wide defaults can land here
// without further schema work.
//
// Additive-only: separate from siteSettings to keep PDP-only concerns
// decoupled (CLAUDE.md: never modify existing schema files).

export default {
  name: 'pdpDefaults',
  title: 'PDP Defaults',
  type: 'document',
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'trustBar',
      title: 'PDP Trust Bar',
      description:
        'Sitewide trust bar shown below the buy button on every product page. Reuses Trust Item documents — link the same items you use in the homepage trust bar to keep things in sync, or link a different set if you want PDP-specific copy.',
      type: 'trustBar',
    },
  ],
  preview: { prepare: () => ({ title: 'PDP Defaults' }) },
}
