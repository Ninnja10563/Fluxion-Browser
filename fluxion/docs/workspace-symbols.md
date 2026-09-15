# Workspace symbols

Fluxion uses five consistent Lucide pictograms for workspace navigation: compass,
code, briefcase, leaf and open book. These identify workspace destinations without
decorative tile backgrounds. Their 24-unit paths retain Lucide's two-unit rounded
stroke and render at 18 CSS pixels; color comes from the surrounding control.
The workspace name, not its chosen symbol, provides the button's accessible name.

## Source and license

The SVG geometry is vendored from [Lucide 0.468.0](https://github.com/lucide-icons/lucide/tree/f12b0de177fbc2a6795e99be065887e72b237123/icons),
commit `f12b0de177fbc2a6795e99be065887e72b237123`. The selected source files are
`compass.svg`, `code-xml.svg`, `briefcase-business.svg`, `leaf.svg` and `book-open.svg`.
Geometry is unchanged; size and accessibility attributes are set by Fluxion.
There is no icon package, network request, runtime SVG parsing, or font dependency.

The [upstream ISC notice](https://github.com/lucide-icons/lucide/blob/f12b0de177fbc2a6795e99be065887e72b237123/LICENSE)
is reproduced in [`workspace-icons.LICENSE`](../chrome/core/workspace-icons.LICENSE)
alongside the shipped module. Preserve that file when packaging or updating the
vendored shapes.

## Integration

`core/workspace-icons.js` exposes `FluxionWorkspaceIcons` in browser chrome and a
CommonJS export in tests. All definitions are deeply frozen:

- `attributes` contains the common SVG attributes, including `viewBox`, 18-pixel
  dimensions, stroke style and decorative accessibility attributes.
- `get(id)` returns `{ label, source, shapes }`; each shape is `{ tag, attributes }`.
  Create elements in the SVG namespace and assign these fixed attributes. Never
  use a workspace name or imported profile value as SVG markup.
- `choices` contains `[persistedId, label]` pairs for the Settings selector.
- `icons` exposes the complete registry. Unknown IDs fall back to the compass.

Existing serialized IDs remain `circle`, `diamond`, `square`, `arc`, and `grid`,
respectively. No workspace/session migration is needed, and changing the label or
appearance of an icon never changes the workspace's identity.
