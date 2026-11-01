import assert from "node:assert/strict";
import test from "node:test";
import { calculateHudLayout } from "../js/modules/hud-layout.js";

test("HUD keeps its fixed grid and selects the largest fitting integer scale", () => {
  for (const [availableWidth, availableHeight, scale] of [
    [359, 900, 1], [360, 900, 1], [719, 900, 1], [720, 900, 2],
    [1080, 900, 3], [1440, 1200, 3], [2000, 2000, 3],
    [1440, 575, 1], [1440, 576, 2], [1440, 863, 2], [1440, 864, 3],
  ]) {
    const layout = calculateHudLayout({ availableWidth, availableHeight });
    assert.equal(layout.scale, scale, `${availableWidth}×${availableHeight}`);
    assert.equal(layout.columns, 30);
    assert.equal(layout.rows, 16);
    assert.equal(layout.cellWidth, 12 * scale);
    assert.equal(layout.cellHeight, 18 * scale);
    assert.equal(layout.width, 360 * scale);
    assert.equal(layout.height, 288 * scale);
  }
});

test("manual HUD zoom stays within both width and height limits", () => {
  const small = { availableWidth: 1007, availableHeight: 640 };
  const large = { availableWidth: 1166, availableHeight: 1100 };
  assert.equal(calculateHudLayout({ ...small, zoom: 1 }).scale, 1);
  assert.equal(calculateHudLayout({ ...small, zoom: 3 }).scale, 2);
  assert.equal(calculateHudLayout({ ...large, zoom: 3 }).scale, 3);
  assert.equal(calculateHudLayout({ ...large, availableHeight: 700, zoom: 3 }).scale, 2);
  for (const availableWidth of [360, 719, 720, 1079, 1080, 1166]) {
    for (const availableHeight of [288, 575, 576, 863, 864, 1200]) {
      for (const zoom of ["auto", 1, 2, 3]) {
        const layout = calculateHudLayout({ availableWidth, availableHeight, zoom });
        assert.ok(layout.width <= availableWidth);
        assert.ok(layout.height <= availableHeight);
        assert.ok(layout.scale <= layout.maxScale);
      }
    }
  }
});

test("small viewports scroll the native HUD instead of shrinking glyph pixels", () => {
  for (const availableWidth of [0, 80, 307]) {
    const layout = calculateHudLayout({ availableWidth, availableHeight: 100 });
    assert.equal(layout.scale, 1);
    assert.equal(layout.width, 360);
    assert.equal(layout.height, 288);
  }
});
