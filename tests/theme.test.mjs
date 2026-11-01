import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME, THEME_KEY, currentThemeId, initThemeControls } from '../js/modules/theme.js';

const ids = ['dusk', 'crt', 'amber-terminal', 'cold-phosphor', 'lavender-circuit', 'field-notes', 'afterburn'];

function fixture(saved) {
  const values = new Map(saved === undefined ? [] : [[THEME_KEY, saved]]);
  const attributes = new Map([['data-theme', 'afterburn']]);
  const root = {
    getAttribute: key => attributes.get(key) ?? null,
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key),
  };
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const changes = [];
  const themeRadios = ids.map(value => ({ value, checked: false, addEventListener(event, handler) { this[event] = handler; } }));
  initThemeControls({ themeRadios, storage, root, onThemeChange: id => changes.push(id) });
  return { root, storage, themeRadios, changes };
}

test('first visits and invalid saved themes default to BURN', () => {
  assert.equal(DEFAULT_THEME, 'afterburn');
  for (const saved of [undefined, '', 'unknown-old-theme']) {
    const { root, storage, themeRadios, changes } = fixture(saved);
    assert.equal(currentThemeId(root), 'afterburn');
    assert.equal(storage.getItem(THEME_KEY), 'afterburn');
    assert.deepEqual(themeRadios.filter(r => r.checked).map(r => r.value), ['afterburn']);
    assert.deepEqual(changes, ['afterburn']);
  }
});

test('every saved theme, including DUSK, takes precedence over BURN', () => {
  for (const saved of ids) {
    const { root, storage, themeRadios, changes } = fixture(saved);
    assert.equal(currentThemeId(root), saved);
    assert.equal(storage.getItem(THEME_KEY), saved);
    assert.deepEqual(themeRadios.filter(r => r.checked).map(r => r.value), [saved]);
    assert.deepEqual(changes, [saved]);
  }
});

test('a new explicit theme choice is saved and restored on the next visit', () => {
  const { root, storage, themeRadios } = fixture();
  const chosen = themeRadios.find(r => r.value === 'field-notes');
  chosen.checked = true;
  chosen.change();
  assert.equal(currentThemeId(root), 'field-notes');
  assert.equal(storage.getItem(THEME_KEY), 'field-notes');
  const restored = fixture(storage.getItem(THEME_KEY));
  assert.equal(currentThemeId(restored.root), 'field-notes');
});
