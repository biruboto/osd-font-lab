# OSD Font Lab Architecture

## JS module layout
- `js/app.js`: app orchestration and feature flow (loading, swap flow, events, render coordination).
- `js/modules/dom-utils.js`: shared DOM/canvas helpers (`cssVar`, HTML escaping, canvas fitting, downloads, clamps).
- `js/modules/theme.js`: theme state + radio control wiring.
- `js/modules/picker.js`: reusable custom dropdown (`buildFontPicker`).
- `js/modules/preview.js`: preview image rendering helpers (font/glyph/overlay previews).
- `js/modules/workspace-render.js`: grid/zoom rendering, canvas hit-testing, PNG sheet rendering.
- `js/modules/selection.js`: selection state + selection actions.
- `js/modules/swap-registry.js`: swap source registration/normalization (Betaflight + custom).
- `js/modules/dpad.js`: d-pad click/hold-repeat behavior.

## CSS module layout
- `css/app.css`: entry file that imports CSS modules.
- `css/themes.css`: theme variables and theme-specific look.
- `css/layout.css`: page-level layout and panel structure.
- `css/controls.css`: controls/widgets (buttons, inputs, pickers).
- `css/workspace.css`: workspace-specific visuals (grids, inspector, panes).

## Maintenance guidance
- Keep `app.js` focused on orchestration and wiring.
- Put reusable logic into `js/modules/*`.
- Prefer pure/stateless module functions where possible.
- Run syntax checks after edits:
  - `node --check js/app.js`
  - `node --check js/modules/<module>.js`

## Quick Regression Checklist
- Import base `.mcm` via dropzone.
- Import YAFF via `Import .yaff` button (confirm diagnostics show imported/skipped counts).
- Apply and clear icon swaps.
- Export `.mcm` and PNG.
- Switch theme and verify preview colors/thumbnails refresh.
