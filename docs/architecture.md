# OSD Font Lab Architecture

## JS module layout
- `js/app.js`: app orchestration and feature flow (loading, swap flow, events, render coordination).
- `js/modules/dom-utils.js`: shared DOM/canvas helpers (`cssVar`, HTML escaping, canvas fitting, downloads, clamps).
- `js/modules/theme.js`: theme state + radio control wiring.
- `js/modules/picker.js`: reusable custom dropdown (`buildFontPicker`).
- `js/modules/preview.js`: preview image rendering helpers (font/glyph/overlay previews).
- `js/modules/workspace-render.js`: grid/zoom rendering, canvas hit-testing, PNG sheet rendering.
- `js/modules/sheet-layout.js`: pure integer-scale display geometry and hit testing for the reflowing glyph browser. This does not define PNG export geometry.
- `js/modules/selection.js`: selection state + selection actions.
- `js/modules/swap-registry.js`: swap source registration/normalization (Betaflight + custom).
- `js/modules/dpad.js`: d-pad click/hold-repeat behavior.
- `js/mcm.js`: text MCM decoding/encoding and the shared binary glyph packer used by file export and device upload.
- `js/modules/serial.js`: MSP v1 framing, serialized request/response exchanges, deadlines, cancellation, connection cleanup, and immutable font uploads. An explicit controller rejection can be retried; a timeout invalidates the connection.
- `js/modules/hud-render.js`: goggles preview composition, default element positions, and hit-test geometry.
- `js/modules/yaff.js` and `js/modules/ttf-overlay.js`: file-to-overlay conversion.

TTF/OTF imports lazily load the locally bundled MIT-licensed opentype.js 2.0.0
parser (`js/vendor/opentype-2.0.0/`). The retained source checks character coverage
before Canvas rendering, caches measurements, and reuses two canvases. A shared
body size and baseline use typical alphanumeric heights (upper-quartile ascent
and median descent of available g/j/p/q/y, falling back to positive body descents),
with supported ink as a fallback for symbol fonts.
Requested size is capped by that body height, reported in status. Wide glyphs
compress horizontally on their own; tall outliers compress vertically around the
shared baseline. Both preserve a one-pixel outline margin. Status reports counts
of narrowed and shortened glyphs. One ornate glyph cannot limit the whole font.
Supported blanks, missing glyphs, and ink lost during thresholding have separate
diagnostics. Missing/vanished glyphs preserve the base font; a supported space is
explicitly blank. The source is released when a new overlay replaces it. Base-font
loads retain the overlay source. Imports share the overlay load generation;
debounced synchronous size updates check that generation and source identity.
Slider changes during an import are read when its font finishes loading.

## Workspace behavior

`app.js` still owns editing state while the document model is being extracted. Painted overrides carry the offset at capture time; rebuilds apply only the difference between that offset and the current nudge. File/default/overlay load generations prevent an older asynchronous selection from replacing a newer one.

The layout no longer measures and locks pane heights in JavaScript. CSS lays out preview, inspector, and tools together on desktop. At 960px and below, `data-workspace-panel` switches between Preview, Edit glyph, and Fonts & icons. Sheet and HUD preview state remains separate from that navigation. The sheet uses integer 2×–4× cells and fills the columns that fit its wrapper. Its canvas has matching bitmap/CSS dimensions, and the current geometry is shared by drawing, grid lines, selection outlines, and hit testing. An incomplete final row contains no selectable glyphs beyond the document's 256 indices. PNG exports use a separate fixed 16×16 layout. `ResizeObserver` schedules repainting when a visible preview or inspector changes size.

The header contains export/upload actions and shared status. Icons, emoji, boot logo, and appearance use native expandable sections. Pixel editing and HUD dragging use pointer events/capture. Rendering theme colors are cached and invalidated on theme changes.

The brand drone's CSS hover moves in physical screen pixels. `brand.js` sets its
travel and step count from the device pixel ratio and refreshes them on resize or
resolution changes. Whole CSS-pixel offsets alone change the rasterized sprite's
area at fractional scaling (such as 125% or 150%), causing visible brightness
pulses even with constant colors. The body remains permanently visible while
only propeller differences alternate. The three layers are pre-rasterized to
whole device-pixel dimensions on load, theme changes, and resize, avoiding further
source scaling during motion. Browser regressions compare screenshot
pixel counts across the hover cycle at desktop and mobile display scales.

## Automated checks

- `npm test`: codec and serial transport tests using native Node APIs and simulated streams.
- `python -m unittest discover -s tests -p '*_test.py' -v`: browser workflows, canvas baselines, responsive sizes, high-DPI touch editing, and simulated upload cancellation. Test dependencies/setup are in the README.
- Actual controller/firmware and physical phone validation are still required before releasing those changes.

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
