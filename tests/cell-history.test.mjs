import test from 'node:test';
import assert from 'node:assert/strict';
import { createCellUndoHistory } from '../js/modules/cell-history.js';

test('undo snapshots span cells in reverse edit order and own their pixels and offsets', () => {
  const history = createCellUndoHistory();
  const glyph = Uint8Array.of(1, 2, 3), offset = {x:1,y:-1};
  history.push(65, glyph, offset);
  glyph[0] = 3; offset.x = 2;
  history.push(66, glyph, offset);
  glyph.fill(0); offset.y = 4;
  assert.deepEqual(history.pop(), {index:66,glyph:Uint8Array.of(3,2,3),offset:{x:2,y:-1}});
  assert.deepEqual(history.pop(), {index:65,glyph:Uint8Array.of(1,2,3),offset:{x:1,y:-1}});
  assert.equal(history.size,0);
  assert.equal(history.pop(),undefined);
});

test('history retains only its newest bounded edits', () => {
  const history = createCellUndoHistory(3);
  for(let i=0;i<5;i++) history.push(i,Uint8Array.of(i),{x:0,y:0});
  assert.equal(history.size,3);
  assert.deepEqual([history.pop().index,history.pop().index,history.pop().index],[4,3,2]);
  assert.equal(history.pop(),undefined);
});

test('replacing a cell discards all of its history while retaining other cells', () => {
  const history = createCellUndoHistory();
  for(const i of [65,66,65,67,65]) history.push(i,Uint8Array.of(1),{x:0,y:0});
  history.discard(65);
  assert.equal(history.size,2);
  assert.deepEqual([history.pop().index,history.pop().index],[67,66]);
  history.discard(65);
  assert.equal(history.size,0);
});

test('clearing a document removes all snapshots and allows fresh history', () => {
  const history = createCellUndoHistory();
  history.push(65,Uint8Array.of(1),{x:0,y:0});
  history.clear();
  assert.equal(history.pop(),undefined);
  history.push(66,Uint8Array.of(2),{x:0,y:0});
  assert.equal(history.pop().index,66);
  assert.throws(()=>createCellUndoHistory(0),RangeError);
});
