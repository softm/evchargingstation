import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSheetGesture } from '../public/js/mobile-map-focus.js';

test('detail sheet drag snaps compact, expanded, and close states', () => {
  assert.equal(resolveSheetGesture('focus-detail', -70), 'expanded-tools');
  assert.equal(resolveSheetGesture('focus-detail', 100), 'map-browse');
  assert.equal(resolveSheetGesture('focus-detail', 20), 'focus-detail');
  assert.equal(resolveSheetGesture('expanded-tools', 70), 'focus-detail');
});

test('list sheet drag snaps compact, expanded, and close states', () => {
  assert.equal(resolveSheetGesture('list-sheet', -70), 'list-sheet-expanded');
  assert.equal(resolveSheetGesture('list-sheet', 100), 'map-browse');
  assert.equal(resolveSheetGesture('list-sheet-expanded', 70), 'list-sheet');
  assert.equal(resolveSheetGesture('list-sheet-expanded', -30), 'list-sheet-expanded');
});
