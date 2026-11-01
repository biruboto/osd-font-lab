# OSD Font Lab Architecture

## JS module layout
- `js/app.js`: app orchestration and feature flow (loading, swap flow, events, render coordination).
- `js/modules/dom-utils.js`: shared DOM/canvas helpers (`cssVar`, HTML escaping, canvas fitting, downloads, clamps).
- `js/modules/theme.js`: theme state + radio control wiring.
- `js/modules/picker.js`: reusable custom dropdown (`buildFontPicker`).
- `js/modules/font-browser.js`: searchable replacement-font browser, keyboard navigation, bounded visible rows, and a three-task preview queue.
- `js/modules/emoji-preview.js`: compact emoji decoding, shared source loading, and a batched preview atlas.
- `js/modules/session-recovery.js`: versioned local snapshots, IndexedDB storage, and serialized automatic saves with an explicit recovery choice.
- `js/modules/announcements.js`: first-visit welcome notice, versioned dismissal preference, and header bell for reopening it.
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

The Fonts panel keeps library browsing separate from the applied replacement.
Library/search filters never clear the active overlay, imported TTF source, edits,
or undo history. Selecting a font loads its full JSON using the shared overlay
load generation; only a successful current request changes the document. The
replacement refreshes manual lettering edits, while retaining edited icons and
boot-logo cells, their captured nudge offsets, and their undo history. Clearing
the replacement or importing YAFF/TTF follows the same rule. Loading a new base
font still clears all manual cell edits and their history. The
applied label and Clear button stay available across filters and local imports.
Entries and preview caches use library-qualified IDs, so matching filenames from
different collections stay distinct. The list mounts only visible rows plus a
small buffer and loads compact per-library previews from `fonts/previews/`.
Theme, case, and stroke changes refresh mounted previews. Full glyph files are
fetched only when selected. Regenerate previews after library updates with
`python scripts/build-font-previews.py`; `--check` verifies all generated files.
On desktop the tools column scrolls within the remaining viewport height, so the
font browser does not extend the page below an otherwise fitted sheet/inspector.
Mobile tools retain normal document scrolling.

The emoji picker loads `fonts/previews/emoji-pixels.json` on first use. This
52 KB catalog packs all 507 original 12×18 glyphs into two bits per pixel;
previewing and applying emoji share its decoded data and pending request.
The picker renders a single preview sheet in small batches and decodes it before
opening. Every thumbnail uses that sheet, so scrolling needs no fetching,
thumbnail rendering, or visibility measurements. Theme and outline changes
replace the sheet atomically; superseded work cannot overwrite newer previews.
Regenerate the catalog after emoji changes with
`python scripts/build-emoji-catalog.py`; `--check` verifies the generated file.

`app.js` still owns editing state while the document model is being extracted. Painted overrides carry the offset at capture time; rebuilds apply only the difference between that offset and the current nudge. File/default/overlay load generations prevent an older asynchronous selection from replacing a newer one.

Automatic recovery stores a single working session in IndexedDB on this browser
and origin. Completed font changes and edit strokes start a save immediately;
view changes are debounced. Page hiding also requests a flush. Snapshots keep
the base font, replacement overlay, explicit overrides, captured offsets,
nudges, emoji assignments, clipboard, selected cells, and bounded undo history
separate. Imported TTF/OTF source files are stored locally as blobs so their size
controls remain usable after restoring. No session data is uploaded.

A returning visitor chooses Restore session or Start fresh in a banner before
automatic saves can replace the previous record. Restoring validates the snapshot
and loads any outline source before changing the current font. A failed restore
keeps the saved record available. Unknown or damaged snapshots can be explicitly
discarded, and unavailable storage leaves editing/export working with a visible
warning. This is browser-local recovery; normal exports remain the portable copy.

The welcome notice uses the same banner style as recovery and links to the GitHub
README and issue tracker. Dismissal is stored per browser for the current notice
ID; changing that ID permits a future announcement to appear once again. The
header bell reopens the notice. Automatic welcome display waits until any recovery
choice is resolved; it never requests browser notification permission.

The layout no longer measures and locks pane heights in JavaScript. CSS lays out preview, inspector, and tools together on desktop. At 960px and below, `data-workspace-panel` switches between Preview, Edit glyph, and Fonts & icons. Sheet and HUD preview state remains separate from that navigation. The sheet uses integer 2×–4× cells and fills the columns that fit its wrapper. Its canvas has matching bitmap/CSS dimensions, and the current geometry is shared by drawing, grid lines, selection outlines, and hit testing. An incomplete final row contains no selectable glyphs beyond the document's 256 indices. PNG exports use a separate fixed 16×16 layout. `ResizeObserver` schedules repainting when a visible preview or inspector changes size.

HUD and Boot previews share `js/modules/hud-layout.js`: a fixed 30×16 grid with integer 1×–3× cells and matching bitmap/CSS dimensions. Their Auto/−/+ zoom control limits manual zoom to the available width and height, and reduces it when a resized window cannot fit the chosen scale. Narrow viewports can scroll the native grid rather than shrink its pixels. The background image scales independently to cover the preview; its toggle replaces it with the theme's transparent glyph color when off. NTSC retains its 13-row safe area and matte rows. Drawing and dragging use the same cell geometry.

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
