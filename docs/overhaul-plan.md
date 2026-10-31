# OSD Font Lab: audit and overhaul plan

Audit date: 2026-10-31. Baseline: `eccb69b`, branch `refactor/redesign`.

## Assessment

The product has a coherent purpose and the underlying technology fits it: a small, client-side editor with canvas previews and static font libraries. The MCM/PNG exchange, glyph replacement model, icon sets, and goggles preview are useful foundations. The main problems are expensive redraws, ambiguous ownership of editing state, and a desktop layout that accumulates exceptions as it gets narrower.

Recommendation: preserve the working formats and domain knowledge, fix demonstrated correctness/performance problems, then rebuild the workspace around available space and the editing workflow. A framework migration is not a prerequisite. A backend is not needed for the existing feature set.

The findings below describe the audit baseline. Production code was not modified during that audit. The first implementation slice is recorded at the end of this document.

## Scope and evidence

Reviewed all 14 tracked JavaScript files, the HTML entry point, all five stylesheets, architecture/README documentation, font manifest structure, and selected local conversion scripts. Validated tracked JSON syntax and file availability. Exercised the site in headless Microsoft Edge through Playwright against the Python server at `http://127.0.0.1:5173/`.

Browser checks covered nine viewport sizes, sheet/HUD switching, default loading, font selection ordering, pixel edits, nudging, keyboard activation, emoji replacement, YAFF/TTF import, MCM and PNG export/import, boot logo PNG/BMP export/import, reload behavior, and theme thumbnails. Also ran JavaScript syntax checks and isolated the serial reader with a fake stalled stream. No controller was connected or written to.

Limits: this is a source and targeted runtime audit, not a visual inspection of every library glyph or every ignored conversion utility. Phone sizes were emulated desktop-browser viewports; real iOS/Android touch behavior remains to be tested. The sandbox blocked the external Font Awesome stylesheet, so absent icon graphics in screenshots are an audit-environment limitation, not a demonstrated production outage. Localhost transfer sizes are uncompressed and are not production loading measurements. Timing results are machine-specific; the style-read measurements instrumented `getComputedStyle`.

Reproduction scripts, JSON results, and before screenshots are in local, Git-ignored `tools/test/overhaul_audit.py`, `overhaul_runtime_audit.py`, `overhaul_workflow_audit.py`, `overhaul_extra_audit.py`, and `tools/test/overhaul-audit/`. Durable regression coverage should move into tracked tests as the first implementation step.

## What is working and should survive

- Static hosting and browser-local processing keep deployment simple; no server-side file processing is necessary for current editing.
- The 256-glyph, 12×18 model matches the intended analog OSD target.
- All 2,381 baseline tracked files are present, and Git integrity passes. All 1,833 asset references checked in library, default, and custom-icon manifests resolve locally.
- The ten included MCM defaults decode/export/decode without pixel changes.
- A clean PNG sheet export/reimport and both native PNG and Betaflight BMP boot-logo round-trips preserved all pixels in the tested baseline. The transformed-session PNG failure described below is a state/composition issue, not a general failure of PNG decoding.
- Emoji replacement, a small YAFF fixture, and Arial TTF import completed successfully. Parser limitations should be explained, rather than silently presented as support for every variant of those formats.
- Existing modules already separate selection, rendering, theme, pickers, and serial transport in useful ways. Extend those boundaries.
- Theme colors are kept out of MCM/PNG export; the HUD uses black/white/transparent rendering. Preserve that distinction.
- Lazy picker thumbnails, request IDs in some preview/TTF paths, and animation pauses for hidden documents show useful performance work already exists.

## Priority findings

### P1: rendering spends most of its work retrieving colors

Sources: [`pxColorViewer`](../js/app.js#L1056), [`renderGrid`](../js/modules/workspace-render.js#L57), [`rerenderAll`](../js/app.js#L3064).

`pxColorViewer` calls `cssVar` four times for every pixel; each calls `getComputedStyle`. One glyph sheet contains 55,296 pixels. A routine selection redraw also paints the hidden base grid, the inspector, and the boot preview. Three instrumented selection events each performed **456,697 computed-style reads**, taking **271–284 ms**. A normal default-load task also exceeded 200 ms in the observed run.

Fix: resolve a small palette once per theme/render, pass it to pure drawing functions, stop rendering the hidden base grid, and render only affected surfaces. Coalesce pointer/resize updates into one scheduled frame. Keep selection outlines separate from the cached sheet pixels. Avoid resetting canvas dimensions when dimensions have not changed. Measure before considering workers, WebGL, or a new rendering library.

### P1: editing a nudged glyph applies its transform again later

Sources: [`rebuildResultFont`](../js/app.js#L2635), [`applyEditorPixel`](../js/app.js#L3214).

The pixel editor copies pixels from the already-composed result into `swapOverrides`. A later rebuild applies per-glyph nudges again. Reproduction: load Betaflight, select glyph 1, nudge right, paint, then change the case toggle with no overlay loaded. The edited glyph changed by **39 pixels** although that case change should not affect it. Exporting/reimporting a PNG in that same transformed session also changed the result, because existing transforms were applied to the baked import.

Fix: choose and enforce a coordinate system for stored edits. Keep override pixels in source coordinates and map painting through the transform, or explicitly bake and clear the relevant transform. Define whether loading a new base starts a document or preserves modifiers; offer an explicit operation if both behaviors are useful. Test sequences, not just individual controls.

### P1: a late asynchronous selection can overwrite the current selection

Source: [`loadOverlayIndex`](../js/app.js#L3453).

With `alarm8x5.json` delayed and `alarm8x8.json` selected next, the picker showed `alarm8x8.json` but the exported font did not match the latest selection. The awaited older response can still assign `currentOverlay`. Similar unguarded patterns exist in base loading and swap application and need coverage.

Fix: give each user intent a generation ID, capture the library/file identity before fetching, and commit only if that intent is still current. Share in-flight fetch promises, not just completed responses. Aborting obsolete fetches can save work, but correctness must not depend on successful cancellation.

### P1: serial timeout does not interrupt a stalled read

Source: [`FCConnection.readMspResponse`](../js/modules/serial.js#L91).

The five-second deadline is checked before `await reader.read()`. An idle stream can leave that await pending indefinitely. A fake reader returning an unresolved promise remained pending after 5.3 seconds. This prevents the existing retry/error path from progressing.

Fix: implement a real operation deadline and cancellation with cleanup of the underlying pending read; a bare `Promise.race` that abandons readers would create another problem. Keep a persistent framed receive buffer, serialize requests, validate responses, and ensure cleanup proceeds even if one release step fails. Add timeout, fragmented-frame, bad-checksum, error-frame, disconnect, and retry tests. Keep the existing prop-removal reminder. Validate final behavior on actual supported hardware before release.

### P1: valid MCM transparency can become opaque black

Sources: [`decodeMCM`](../js/mcm.js#L5), [`encodeMCM`](../js/mcm.js#L67), duplicated packing in the FC upload handler.

The decoder retains raw two-bit value `3`, but the editor uses `3` for black stroke. Encoding then maps it to black. A synthetic valid MCM of `11111111` byte lines exported `00000000` byte lines. Both `01` and `11` represent transparent pixels in the [manufacturer's format documentation](https://www.analog.com/en/resources/design-notes/generating-custom-characters-and-graphics-by-using-the-max7456s-memory-and-ev-kit-file-formats.html). The ten bundled defaults contain no raw `3` pixels, explaining why their round-trips pass.

Fix: normalize hardware pixels at the import boundary and use one canonical black/white/transparent representation. Share binary packing between file export and serial upload. Preserve visual meaning; byte-identical padding or interchangeable transparency codes are not the correctness criterion.

### P1: the responsive layout loses the workspace

Sources: [`layout.css`](../css/layout.css), [`workspace.css`](../css/workspace.css), [`syncPaneBaseline`](../js/app.js#L427).

The sheet always draws at 576×864 CSS pixels. Its wrapper uses `width: max-content`; fixed inspector/control widths compete for space. JavaScript also holds panel heights measured in Sheet mode and carries them into HUD mode. The 1100px layout breakpoint, 1450px wrapping rule, compact-density overrides, and CSS import order make behavior difficult to predict.

Observed after loading the default, with a fresh browser context for each size:

| Viewport | Sheet page size | Inspector position | Consequence |
| --- | --- | --- | --- |
| 1920×1080 | 1905×1080 | Beside sheet | Usable desktop baseline |
| 1440×900 | 1425×907 | Beside sheet | Mostly fits |
| 1366×768 | 1351×1709 | Below sheet | Abrupt jump to a very tall workspace |
| 1280×720 | 1265×1709 | Below sheet | Same problem; inherited HUD height is also excessive |
| 1100×800 | 1085×2318 | Below sheet | Main tools begin at document y=1478 |
| 1024×768 | 1009×2318 | Below sheet | Long travel between selection and controls |
| 768×1024 | 753×2318 | Below sheet | Tablet layout remains a long desktop stack |
| 390×844 | 476×2723 | Below sheet | Sheet begins at x=-100; tools begin at y=1849 |
| 360×800 | 461×2740 | Below sheet | Sheet begins at x=-115; horizontal overflow |

Page width on desktop reflects the browser scrollbar. The negative sheet positions on phones are real clipping, not the scrollbar. HUD controls also overflow at phone widths. Switching to a control far down the page can scroll the page automatically, making the preview disappear above it.

Fix: design explicit spacious, compact, and phone arrangements around task access; remove equal-height measurement locks. Keep logical canvas resolution independent of display scale and use a measured wrapper for integer pixel zoom. On small screens, fit a readable sheet and provide an intentional zoom/pan mode instead of clipping the document.

### P2: loading and branding do unnecessary work before editing

Sources: [`init`](../js/app.js#L4694), [`prewarmSpecialEmojiPreviews`](../js/app.js#L1539), [`initBrandTitle`](../js/app.js#L3588), manifest loaders near line 3288.

In one fresh visit before editing, 146 requests were observed, including **96 emoji data requests**, with approximately **1.88 MB** of resource bodies on the uncompressed local server. One manifest was requested three times and the Ko-fi icon twice. Parallel initializers cache only completed loads, so they can duplicate in-flight work. The title loads random full fonts and rerolls them over time; caches are not bounded. The full tracked font data is roughly 78 MB, but it is not all downloaded at startup.

Fix: one asset repository with promise deduplication, explicit cache keys including library/theme/stroke, and an eviction policy where needed. Load thumbnails on demand with a concurrency limit. Store a small catalog/count summary rather than reading full manifests for decoration and counters. Give branding a small local asset set and respect reduced-motion preferences. Preserve the playful character without making the editor's readiness depend on it.

### P2: accessibility and input behavior are incomplete

Sources: [`picker.js`](../js/modules/picker.js), [`dpad.js`](../js/modules/dpad.js), HUD events in [`app.js`](../js/app.js#L4327), [`index.html`](../index.html).

Keyboard Enter on a focused nudge button did not change the exported glyph; clicking the same button did. Nudge actions are attached to `mousedown`, not normal button activation. HUD dragging is mouse-only. Pixel editing uses pointer events but lacks pointer capture and dedicated touch-action handling. The import dropzone has button semantics and a tab stop but no keyboard activation handler. Picker rows are click-only divs, expanded/selected semantics are incomplete, and offscreen native selects remain in the focus sequence. Theme radios and directional icon buttons need meaningful accessible names; toggles need programmatic state. Canvases need an accessible selection path. No reduced-motion rules are present.

Fix: shared accessible controls, standard keyboard activation, arrow-key glyph navigation, pointer capture with cleanup, and touch support. Use self-contained icons so essential controls do not depend entirely on a remote icon font. Test names, focus order, focus visibility, menu behavior, and 200% zoom as behavior, not just an automated score.

### P2: document state, history, and recovery need explicit boundaries

The 4,718-line `app.js` owns imports, font composition, editor overrides, nudges, emoji assignments, boot tiles, preview preferences, layout measurement, animation, and device upload. The shared `swapOverrides` map holds several kinds of edits; clearing swaps also removes pixel edits and boot tiles. Undo is limited to one paint stroke. Preferences/HUD layout persist, but the actual working font and edits do not; reload returns to "No file loaded." Some storage operations are unguarded.

Fix: a document model with explicit layers and commands, separate selection/view/preferences, deliberate clear/reset actions, grouped undo/redo, and versioned recovery. Browser autosave and a portable project file should be scoped as follow-up product improvements, with self-contained imported data rather than references to unavailable local files. Use a storage adapter that tolerates unavailable or full storage.

### P2/P3: libraries and maintenance lack a repeatable pipeline

The manifests contain 1,286 replacement fonts plus 507 emoji entries. JSON syntax and asset existence pass, and there are no duplicate IDs/files within the inspected manifests. The library picker mixes collection navigation and font selection in one menu with no search. Preview cache invalidation skips already-mounted menu images; a loaded default-font thumbnail retained the same image URL after switching to CRT. YAFF handles a deliberately narrow bitmap subset; TTF rasterization centers glyphs individually, so baselines and proportions merit an explicit quality pass.

Conversion tools are entirely ignored by Git, including scripts and workflow documentation. A fresh clone can run the app but cannot reproduce the asset pipeline. The ignored state-save file is stale: it describes a different branch, counts, and an Amiga library absent from the current tracked app. No tracked package/test/CI setup exists. The architecture document omits newer major systems.

Fix: commit selected maintained converters and small fixtures; continue ignoring raw sheets, generated scratch files, and chat backups. Validate schemas, dimensions, exact filename case, character coverage, and provenance. Generate honest coverage flags instead of hardcoded `hasUpper/hasLower/hasDigits`. Keep asset attribution/source/license information with the maintained inventory. Add an accurate local-run guide, a feature map, and a small automated check pipeline.

## Proposed system

Keep native modules and the current static deployment initially. Separate responsibilities by what can change independently:

| Area | Responsibility |
| --- | --- |
| Font document | Canonical pixels, base font, overlay configuration, typed glyph/boot overrides, transforms |
| Composer | Pure deterministic document-to-result composition; one documented precedence order |
| Commands/history | Apply edits atomically; undo/redo; group a paint stroke or held nudge |
| Import/export | MCM, PNG, YAFF, TTF, boot formats; validation and normalized results |
| Asset repository | Catalogs, sources, deduplicated loads, bounded preview/data caches |
| Renderers | Sheet, selection, inspector, HUD, boot; palette passed in, no state mutation |
| UI controllers | Bind accessible controls to commands; selection, dialogs, layout and focus |
| Preferences/recovery | Versioned storage, graceful failures, separate document and UI state |
| Serial transport | Framing, deadlines, cancellation, device capabilities, upload snapshot |

Centralize Betaflight glyph metadata so labels, swap targets, protected characters, and HUD samples cannot drift apart. Keep the preview layout distinct from the flight controller's actual OSD layout; the current explanatory note is correct and should stay visible near preview controls.

## Proposed workspace

Provisional direction pending answers about visual identity and phone priority: retain the pixel-art/drone character and themes, while simplifying hierarchy and behavior.

- **Persistent top-level actions:** start/import, undo/redo, preview mode, export/upload. Explain export formats through labels and nearby help.
- **Preview workspace:** Sheet and HUD tabs above the preview itself. Keep preview controls with that preview rather than in a distant column.
- **Font browser:** searchable fonts with collection filters and visible sample previews. Distinguish changing the base font from replacing printable characters.
- **Inspector/editor:** selection metadata, pixel tools, and nudge controls together. Keep them reachable without scrolling past the whole sheet.
- **Secondary tools:** Icons, emoji, and boot logo in clearly named sections. Show controls such as TTF size only when relevant. Move theme and project support out of the primary edit path.
- **Wide displays:** preview, inspector, and library/tools can sit alongside one another when their minimum useful sizes fit.
- **Laptop/tablet:** prioritize preview plus the active tool; use tabs/drawers for the remaining tools. Avoid a 1,700px-high arrangement merely to preserve two columns.
- **Phones:** switch between Preview, Fonts, and Edit surfaces, with persistent navigation and useful export access. The selected glyph and document stay shared between surfaces. Full phone-editing ambitions remain a product decision.

Avoid implementing this as a strict wizard: experienced users need to revisit fonts, icons, and previews freely.

## Implementation sequence

| Phase | Deliverable | Completion gate |
| --- | --- | --- |
| 0. Lock down behavior | Tracked fixtures, targeted core tests and browser smoke checks; baseline screenshots and timings | Demonstrated failures are reproducible; existing passing file flows are protected |
| 1. Fix correctness and obvious waste | MCM normalization/shared packing, edit-transform behavior, selection races, real serial deadlines, palette caching, hidden-grid removal, keyboard buttons | Targeted regression checks pass; measured selection redraw cost drops substantially |
| 2. Establish document boundaries | Extract composer, document commands, asset repository, serial controller, and render scheduler in small reviewable changes | Same exports and expected editing behavior; state changes have explicit ownership |
| 3. Rebuild responsive workspace | Choose one visual prototype, then implement spacious/compact/phone arrangements; replace height locks | All target widths usable, no document-level horizontal overflow, tools stay reachable |
| 4. Streamline browsing and loading | Search/filter UI, on-demand previews, request deduplication, relevant controls, lightweight branding | Initial route does not fetch unvisited emoji/font data for decoration; latest selection always wins |
| 5. Add editing resilience | Grouped undo/redo, dirty state, recovery/project-save scope, storage failure handling | Edits can be recovered/undone; importing and resetting have explicit behavior |
| 6. Release validation | Browser/device matrix, import/export regression suite, controller validation, docs and asset tooling | Tested hosted preview; hardware checks complete before merging/releasing upload changes |

Small reviewable commits should preserve a working site throughout. Keep live `main` stable while the redesign branch evolves. Introduce build tooling only when it earns its maintenance cost, for example checks and hashed production assets; do not bundle the whole font collection into application code. Favorites, online sharing, accounts, cloud storage, a PWA/offline mode, and broader firmware support are separate scope decisions.

## Acceptance criteria

- Layout at 360/390px phone widths, 768px tablet, 1024px, 1280×720, 1366×768, 1440×900, 1920×1080, and a larger display; check portrait/landscape, DPR 1/2, browser zoom at 200%, fresh visits, saved HUD mode, and live resize/orientation changes.
- No clipped glyph columns or inaccessible actions. At deliberate high zoom, pan inside a bounded canvas viewport rather than overflowing the document. Keep pixel-to-glyph hit testing accurate across scales.
- Preserve logical dimensions and exported pixels independently of theme, display scale, DPR, and preview mode.
- Selection-only changes should not clone/recompose the font or paint a hidden canvas. Palette reads should be bounded per update rather than proportional to pixel count. Proposed target: typical selection/nudge interactions under 50 ms on the audit desktop, then establish and meet a separate throttled/mobile budget.
- No startup emoji prewarming or random full-font downloads solely for branding. Establish cold/warm production transfer/request budgets after measuring the real host; do not treat localhost numbers as field performance.
- MCM/PNG/boot round-trips preserve visual pixels. Both hardware transparency codes work. Malformed/oversized imports report useful errors and leave the current document intact.
- Rapid font/library/base/source changes cannot commit stale results. Slow/failing fetches expose retryable state.
- Nudging, painting, changing overlays, importing a base, undoing, and exporting have tested sequence semantics. Clear icons must not silently erase an unrelated boot logo or paint work.
- Keyboard and touch cover core editing; accessible labels/state and focus behavior work. Reduced-motion preference is respected.
- Serial reads actually time out; retries/cancellation/disconnect clean up. File and serial output share the same packer. Unit tests do not substitute for a controller test.
- Small CI suite: syntax/type or lint checks as selected, document/codec tests, asset validation, and a handful of representative browser flows. Avoid brittle snapshots of every decorative element.

## Product decisions to settle

1. Retain the present visual identity, or explore a different direction? The technical recommendations do not depend on this answer.
2. How much of the full editor should be available on phones? Default proposal is desktop-first with usable tablet/phone workflows.
3. Which user complaints and community requests are highest priority, and which features/details must stay?
4. Is the scope still analog Betaflight/MAX7456? Keep that as the initial supported target unless expansion is explicitly wanted.
5. On importing another base font, should edits reset or be deliberately reapplied? Make the choice explicit and recoverable.
6. What controller/firmware/browser combinations can be used for final hardware validation?

The first implementation slice should be Phase 0 plus the palette/hidden-grid fixes and focused correctness regressions. That produces a measurable improvement and protects the audience's existing workflows before the workspace moves.

## Implementation record: first stabilization slice

Started 2026-10-31 on `refactor/redesign`.

Implemented:

- Theme palette values are resolved once and invalidated on theme changes; hidden base-grid drawing is removed. Grid canvases resize only when dimensions change. Selection does not repaint the boot preview.
- Both MCM transparency codes normalize to transparent editor pixels. File export and FC upload share one validated glyph packer.
- Painted glyphs record the transform at capture time, so subsequent rebuilds apply only the relative offset. Undo retains that reference and works after a later nudge. This is a focused correction within the current model; the broader document/layer extraction is still planned.
- Overlay/default loads use generation guards. File imports invalidate the corresponding older requests. Overlay fetches share pending promises. Swap selection ignores superseded results and results from a previous base font.
- Nudge buttons support keyboard activation and pointer events for mouse/touch, with hold timers stopped on release, cancellation, blur, or hidden documents.
- Added dependency-free Node codec tests and a Python/Playwright browser suite, plus canvas baselines for five themes and local development/check instructions.

Validation includes the ten bundled MCM defaults, synthetic transparency/packing/invalid-input fixtures, unchanged baseline pixels on 15 theme canvases, clean PNG and both boot formats, delayed responses, and painting/undo with global and per-glyph offsets. Initial post-change selection samples were 20–30 ms with three style reads, compared with 271–284 ms and 456,697 reads at the audit baseline. These are local instrumented measurements, not field performance guarantees.

At the end of this first slice, serial deadlines/cancellation remained outstanding and no visual layout changes had been made. The next implementation record covers that work. The base-import reset policy remains unchanged.

## Implementation record: serial safeguards and responsive workspace

Implemented 2026-10-31, continuing on `refactor/redesign`.

Transport:

- Serialized request/response exchanges have actual write/read deadlines. Timeout, cancellation, and disconnect reject pending work and release the reader. Releasing a reader rejects its pending reads as specified by the [Streams Standard](https://streams.spec.whatwg.org/#default-reader-release-lock).
- The parser retains partial/trailing frames, checks checksums, skips unrelated replies, and handles negative acknowledgements. Only explicit controller rejections are retried; a timeout aborts the connection so a late ACK cannot be reused for another write.
- Cleanup attempts all resources even when a release fails. Partial connection setup and cancellation during settling are covered.
- The UI snapshots the font before connecting. During upload the same button becomes Cancel, and shared status remains visible. Cancellation explains that characters already written are not rolled back. Empty OSD responses now fail the check.

Workspace:

- Replaced measured height locks and compact-density exceptions with content-sized desktop panes and a CSS layout for smaller screens.
- Export/upload actions and shared status live in the header; Sheet/HUD switching is next to the preview. Preview, Edit glyph, and Fonts & icons navigation is available at 960px and below. Loading a base font opens Preview.
- Fit mode keeps the sheet within the available space. Explicit 2×/3× zoom pans inside a bounded preview, including access to the final row/column. Inspector sizing responds to container changes without shrinking permanently after a hidden view or smaller window.
- Icons, special characters, boot logo, and appearance are expandable sections. Theme/support controls moved out of the inspector. Nudge/stroke/undo controls have usable text glyphs without the remote icon font; theme controls have accessible names. Base import uses a native button.
- Touch pixel editing and HUD dragging use pointer capture. Branding respects reduced motion on initialization. Removed the obsolete hidden base-grid element/handlers.

Validation: 21 Node tests and 12 browser tests pass. Browser coverage includes 14 viewport configurations from 360px to 2560px, landscape/laptop sizes, live resizing, bounded zoom/pan, DPR 2 touch painting, saved HUD mode, a fake device cancellation flow, and unchanged baseline pixels across all five themes. Final local selection samples were 18–24 ms with five style reads after adding responsive inspector measurements. Visual review covered desktop/laptop and phone Preview/Edit/Tools/HUD views. The 1366×768 default sheet now fits a 768px-high page in the reviewed state, compared with 1709px at baseline; the 390×844 preview fits the page without clipped columns.

Remaining: document/layer extraction, stronger history/recovery, library search/loading simplification, broader accessibility, and cross-browser/physical-device validation. This is the first responsive implementation with the existing visual identity, not the final visual redesign. Serial changes have been tested with simulated streams and a fake browser device; actual controller validation has not been performed.

## Implementation record: reflowing integer-scale sheet

The on-screen browser now fills the available columns instead of keeping 16 columns and scaling the whole sheet. Auto chooses the largest fitting integer zoom from 2×–4×, with 2× as a readable minimum; explicit 2×/3×/4× modes can scroll vertically. The default desktop 1440px view uses 20 columns at 3×, while the reviewed 390px phone view uses 13 columns at 2×.

`sheet-layout.js` owns display geometry and hit testing. Drawing, grid lines, and selection use the same layout; resizing preserves the selected glyph's original index. Blank cells after index 255 are ignored. PNG export continues to use its independent 16×16 layout.

Validation: 25 Node tests and 13 browser tests pass. New checks cover integer zoom/column counts, every glyph's hit-test coordinates at several widths, incomplete rows and bounds, selection stability across reflows, and byte-identical 1×/3× PNG exports before/after resizing. Existing theme pixel baselines are checked at their original 16-column geometry so a display rearrangement does not replace the visual correctness baseline.

## Implementation record: animated branding

The original title and drone each ran a requestAnimationFrame loop. On the audit display they produced roughly 230 JavaScript callbacks and 1,100 inline-style mutations per second; the title also resolved theme colors on every frame. Each glitch chose more complete font JSON files and retained them in the application's overlay cache. Reduced motion was checked only on initialization, so enabling it later did not stop the loops. Hidden-tab handling already stopped the JavaScript loops.

Branding is now isolated in `js/modules/brand.js`. CSS drives the wave, glitch flicker, drone hover, and two-frame propeller animation. JavaScript paints letters only on initialization, rerolls, and theme changes, and tints both drone frames only on initialization/theme changes. Visibility and page lifecycle events pause CSS and cancel scheduled rerolls; changes to the reduced-motion preference immediately stop all branding motion. Cleanup removes listeners, cancels timers, and guards pending asset loads. A readable, accessible text title survives failed catalog requests.

A generated 287,788-byte catalog retains the nine distinct uppercase letters from all seven libraries, deduplicating 7,298 clipped shapes and preserving each eligible source font's selection weight. The 1,286 source entries include one font without these letters; empty choices are excluded so they cannot make the logo disappear. Rerolls need no new full-font downloads or growing overlay cache. `scripts/build-brand-glyphs.py --check` verifies that the asset matches the font sources; regenerate it after library changes.

The local idle check now records zero JavaScript animation callbacks, inline-style mutations, or computed-style reads over 1.2 seconds while the logo remains animated. CSS animations still require browser rendering work. This is a local measurement, not a claim of zero CPU usage. Desktop and phone headers were visually reviewed, including the centered status and right-side exports.

Validation: 27 Node tests and 16 browser checks pass, including the full reroll's network requests, both glitch layers' theme pixels, live reduced-motion changes, initial reduced motion, hidden-tab/page lifecycle pause and resume, teardown, and failed-asset fallback. Catalog regeneration matches all source files. Existing font export, editing, responsive layout, and theme baselines remain covered.

Follow-up drone shimmer: both source frames have identical ink color, alpha, and ink-pixel counts. The original smooth CSS hover survived the refactor and placed the pixel art between pixel rows. On the local desktop renderer, a half-pixel offset reduced visible ink coverage from 624 to 588 screen pixels, producing a brightness shimmer without changing the ink color. The hover now steps through whole-pixel offsets (0, 1, 2, 3), keeping the bob and propeller effects. Ten sampled positions retained 624 ink pixels. An additional browser regression checks both complete frame palettes and 89 hover positions; it passes. Display scaling can still affect perceived sharpness, as previously discussed.

The user still observed brightness flashing after that mitigation, so it did not establish the cause of their reported effect. The drone now separates 146 common opaque body pixels into a permanently visible canvas and switches visibility only for each frame's ten remaining propeller pixels. Full-drone opacity switching is removed. Browser checks reconstruct both original alpha masks exactly, verify the body remains fully opaque and visible throughout the cycle, and retain theme, motion preference, lifecycle, fallback, and idle-work checks. This removes full-body frame replacement as a possible contributor; the perceived result still needs to be assessed on the user's display.

The user subsequently confirmed that the perceived flashing remains and requested keeping these changes. The brightness issue remains unresolved.

## Implementation record: independent inspector zoom

Sheet zoom now aligns with the sheet column's right edge. A separate Inspector zoom control applies to both Inspector and Editor mode and remembers its setting. Auto chooses an integer CSS scale using the available width and the viewport height remaining after the inspector's other controls. Manual choices span 4×–20×; a bounded glyph viewport allows horizontal scrolling when a manual size exceeds the column width. Shrinking the canvas reduces the actual inspector/panel height, rather than visually scaling a fixed-height box.

The sheet's scroll limit now uses its actual document position, so a wrapped header on a small laptop cannot invalidate a fixed header-height estimate. The 1024×768 and 1366×768 Auto views fit the viewport in the regression. Very short screens retain natural page scrolling when the controls themselves need more room.

Validation covers reduced panel height at 8× versus 16×, independent sheet geometry, byte-identical PNG exports, unchanged font pixels, painting and undo at the chosen scale, saved zoom after navigation, Auto sizing at three laptop/desktop resolutions, and touch painting at DPR 2 with manual inspector zoom. Existing theme pixel baselines remain unchanged at their original geometry.

The smaller editor exposed touch hit adjustment redirecting a top-edge tap to the Inspector mode button. The canvas now registers as a click target alongside its existing pointer handlers, preserving exact edge-pixel painting in the DPR 2 regression. The 27 Node and 18 browser cases are validated, with focused reruns after the viewport and touch changes.

Toolbar refinements keep the Sheet View/HUD View pair at a compact, consistent width in both modes. Its left edge and the sheet zoom control's right edge follow the visible sheet, including centered spare space and scrollbar gutter. HUD mode aligns the same button pair with the HUD preview. Alignment was verified at five viewport widths and all four sheet zoom settings.
