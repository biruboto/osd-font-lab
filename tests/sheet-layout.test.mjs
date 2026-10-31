import assert from "node:assert/strict";
import test from "node:test";
import { calculateSheetLayout, sheetPointToIndex } from "../js/modules/sheet-layout.js";

test("fixed integer zoom fills the available columns instead of imposing 16", () => {
  const narrow = calculateSheetLayout({ availableWidth: 540, zoom: 3 });
  const wide = calculateSheetLayout({ availableWidth: 720, zoom: 3 });
  assert.deepEqual([narrow.columns,narrow.rows,narrow.width,narrow.height], [15,18,540,972]);
  assert.deepEqual([wide.columns,wide.rows,wide.width,wide.height], [20,13,720,702]);
  assert.equal(narrow.cellWidth, 36);
  assert.equal(wide.cellHeight, 54);
});

test("auto chooses the largest fitting integer zoom, keeping 2x as its readable minimum", () => {
  const options = { availableWidth: 740, availableHeight: 720 };
  assert.equal(calculateSheetLayout(options).scale, 3);
  const tiny = calculateSheetLayout({ availableWidth: 307, availableHeight: 400 });
  assert.equal(tiny.scale, 2);
  assert.equal(tiny.columns, 12);
  assert.ok(tiny.height > 400, "scroll vertically instead of shrinking glyphs below 2x");
});

test("every glyph remains reachable by index across widths and zoom levels", () => {
  for (const availableWidth of [1, 80, 307, 540, 720, 1100]) {
    for (const zoom of ["auto", 2, 3, 4]) {
      const layout = calculateSheetLayout({ availableWidth, availableHeight: 700, zoom });
      assert.ok(Number.isInteger(layout.scale));
      assert.ok(Number.isInteger(layout.width));
      for (let index = 0; index < 256; index++) {
        assert.equal(sheetPointToIndex((index % layout.columns + 0.5)*layout.cellWidth,
          (Math.floor(index/layout.columns) + 0.5)*layout.cellHeight, layout), index);
      }
    }
  }
});

test("incomplete final rows and every outside edge have no selectable glyph", () => {
  const layout = calculateSheetLayout({ availableWidth: 720, zoom: 3 });
  assert.equal(sheetPointToIndex(16.5*36,12.5*54,layout), null); // blank cell after glyph 255
  for (const [x,y] of [[-1,10],[10,-1],[720,10],[10,702]]) {
    assert.equal(sheetPointToIndex(x,y,layout), null);
  }
  assert.equal(sheetPointToIndex(15.5*36,12.5*54,layout), 255);
});
