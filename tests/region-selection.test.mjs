import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRegionSearchArea, selectViewportRegions } from '../public/js/data.js';

const raw = [
  { code: '11', name: '서울', bounds: { south: 33, north: 37.85, west: 125, east: 129.36 } },
  { code: '36', name: '세종', bounds: { south: 36.28, north: 37.17, west: 127.08, east: 127.4 } },
  { code: '30', name: '대전', bounds: { south: 35.12, north: 37.94, west: 126.92, east: 129.16 } },
  { code: '41', name: '경기', bounds: { south: 33, north: 38.98, west: 125, east: 130.12 } },
  { code: '28', name: '인천', bounds: { south: 33.28, north: 37.97, west: 125.7, east: 128.99 } },
  { code: '26', name: '부산', bounds: { south: 34.58, north: 37.60, west: 126.65, east: 129.36 } },
];

test('bad but numerically valid upstream bounds no longer hide Seoul from a Seoul viewport', () => {
  const entries = raw.map(normalizeRegionSearchArea);
  const seoulView = { south: 37.51, north: 37.63, west: 126.92, east: 127.05 };
  const selected = selectViewportRegions(entries, seoulView, 4);
  assert.equal(selected[0].code, '11');
  assert.ok(selected.some(region => region.code === '11'));
  const seoul = entries.find(region => region.code === '11');
  assert.ok(Math.abs((seoul.bounds.south + seoul.bounds.north) / 2 - 37.5665) < 0.00001);
  assert.ok(Math.abs((seoul.bounds.west + seoul.bounds.east) / 2 - 126.978) < 0.00001);
});

test('manual Busan selection uses a representative map center rather than a polluted bbox midpoint', () => {
  const busan = normalizeRegionSearchArea(raw.find(region => region.code === '26'));
  assert.ok(Math.abs((busan.bounds.south + busan.bounds.north) / 2 - 35.1796) < 0.00001);
  assert.ok(Math.abs((busan.bounds.west + busan.bounds.east) / 2 - 129.0756) < 0.00001);
  const entries = raw.map(normalizeRegionSearchArea);
  const busanView = { south: 35.12, north: 35.25, west: 129.01, east: 129.15 };
  assert.equal(selectViewportRegions(entries, busanView, 4)[0].code, '26');
});

test('off-map bounds do not load unrelated provinces, and future region codes remain intact', () => {
  const entries = raw.map(normalizeRegionSearchArea);
  const farView = { south: 29.9, north: 30, west: 120, east: 120.1 };
  assert.deepEqual(selectViewportRegions(entries, farView, 4), []);
  const future = { code: '99', bounds: { south: 35, north: 36, west: 127, east: 128 } };
  assert.deepEqual(normalizeRegionSearchArea(future), future);
});
