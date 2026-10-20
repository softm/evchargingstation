/** SOFTM-EV-MAP-TEST START 날짜:20261019 : 실제 탐색에서 생기는 번호 불일치·잘못된 좌표·상세 이동 재조회 회귀를 검증 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildMarkerModels, containsCoordinate, createViewportGate, isCoordinate, labelBudget, markerHtml, markerScale, normalizeBounds, parseSharedView, selectMarkerModels } from '../public/js/map.js';

test('좌표 미제공·빈 문자열·NaN을 실제 0도 위치로 바꾸지 않는다', () => {
  for (const point of [null, {}, { lat: null, lng: null }, { lat: '', lng: '' }, { lat: '37.5', lng: '127' }, { lat: NaN, lng: 127 }, { lat: 91, lng: 127 }, { lat: 0, lng: 0 }]) assert.equal(isCoordinate(point), false);
  assert.equal(isCoordinate({ lat: 37.5, lng: 127 }), true);
});

test('공유 지도는 좌표와 실제 지원 배율을 복원하고 빈 좌표를 0도로 해석하지 않는다', () => {
  assert.deepEqual(parseSharedView(new URLSearchParams('lat=37.56&lng=126.98&z=13')), { center: { lat: 37.56, lng: 126.98 }, zoom: 13 });
  for (const query of ['', 'lat=&lng=', 'lat=37.5', 'lat=NaN&lng=127', 'lat=91&lng=127', 'lat=0&lng=0']) assert.equal(parseSharedView(new URLSearchParams(query)), null, query);
  for (const zoom of ['', 'no', '0', '100']) assert.equal(parseSharedView(new URLSearchParams(`lat=37.56&lng=126.98&z=${zoom}`)).zoom, 14);
  for (const zoom of [6, 19]) assert.equal(parseSharedView(new URLSearchParams(`lat=37.56&lng=126.98&z=${zoom}`)).zoom, zoom);
});

test('좌표가 없는 목록 항목을 지도에서 제외해도 마커 번호는 원래 목록과 일치한다', () => {
  const stations = [{ id: 'A', name: '첫째', lat: null, lng: null }, { id: 'B', name: '둘째', lat: 37.5, lng: 127 }, { id: 'C', name: '셋째', lat: 37.51, lng: 127.01 }];
  const summaries = new Map([['B', { total: 4, available: 2, tone: 'available', label: '충전 대기 2 / 전체 4' }]]);
  const models = buildMarkerModels(stations, { selectedId: 'C', summaries });
  assert.deepEqual(models.map(model => [model.id, model.number, model.selected]), [['B', 2, false], ['C', 3, true]]);
  assert.equal(models[0].count, '4기');
  assert.equal(models[0].tone, 'available');
  assert.equal(models[1].tone, 'unknown');
  assert.equal(models[1].count, '—');
});

test('잘못된 상태 집계를 충전 가능 마커로 표시하지 않고 중복 ID를 한 번만 그린다', () => {
  const station = { id: 'ME000001', name: '충전소', lat: 37.5, lng: 127 };
  const models = buildMarkerModels([station, { ...station }], { summaries: new Map([[station.id, { available: 3, total: 1, tone: 'available' }]]) });
  assert.equal(models.length, 1);
  assert.equal(models[0].tone, 'unknown');
  assert.equal(models[0].count, '1기');
});

test('수집된 이름·ID·상태 문구는 HTML 속성과 본문으로 안전하게 표시한다', () => {
  const stations = [{ id: 'A" onclick="evil()', name: '<img src=x onerror=evil()>', lat: 37.5, lng: 127 }];
  const html = markerHtml(buildMarkerModels(stations)[0]);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('data-station-id="A" onclick='), false);
  assert.match(html, /&lt;img/);
  assert.match(html, /&quot;/);
  assert.match(html, /aria-pressed="false"/);
  assert.equal(html.includes('ev-map-pin-number'), false);
  assert.equal(html.includes('ev-map-pin-glyph'), true);
  assert.equal(html.includes('>1</span>'), false);
});

test('상세를 위한 내부 이동 이후 idle과 resize는 기존 목록을 보존한다', () => {
  const gate = createViewportGate();
  gate.userChange();
  gate.preserve();
  assert.equal(gate.consume(), false);
  gate.resize();
  assert.equal(gate.consume(), false);
  gate.userChange();
  assert.equal(gate.consume(), true);
  assert.equal(gate.consume(), false);
  gate.resize();
  assert.equal(gate.consume(), true);
});

test('지도 영역 경계의 충전소를 누락하지 않으며 잘못된 사각형은 조회하지 않는다', () => {
  const bounds = { south: 37, north: 38, west: 126, east: 128 };
  assert.equal(containsCoordinate(bounds, { lat: 37, lng: 126 }), true);
  assert.equal(containsCoordinate(bounds, { lat: 38, lng: 128 }), true);
  assert.equal(containsCoordinate(bounds, { lat: 38.001, lng: 127 }), false);
  assert.equal(containsCoordinate(bounds, { lat: null, lng: 127 }), false);
  assert.equal(normalizeBounds({ ...bounds, south: 39 }), null);
  assert.equal(normalizeBounds({ south: 100, north: 110, west: 120, east: 130 }), null);
});

test('화면 안을 우선 표시·상한 제한하면서 범위 밖 선택 충전소와 원본 목록 번호를 보존한다', () => {
  const bounds = { south: 37, north: 38, west: 126, east: 128 };
  const stations = [{ id: 'outside', lat: 36, lng: 125 }, { id: 'buffer', lat: 36.95, lng: 127 },
    { id: 'edge', lat: 37, lng: 126 }, { id: 'center', lat: 37.5, lng: 127 }, { id: 'last', lat: 37.8, lng: 127.8 }];
  const uncapped = selectMarkerModels(stations, bounds, { limit: 10 });
  assert.deepEqual(uncapped.models.map(model => [model.id, model.number]), [['buffer', 2], ['edge', 3], ['center', 4], ['last', 5]]);
  assert.equal(uncapped.visibleCount, 3);
  assert.equal(uncapped.limited, false);
  const capped = selectMarkerModels(stations, bounds, { selectedId: 'outside', limit: 3 });
  assert.deepEqual(capped.models.map(model => [model.id, model.number]), [['outside', 1], ['edge', 3], ['center', 4]]);
  assert.equal(capped.models[0].selected, true);
  assert.equal(capped.omittedCount, 1);
  assert.equal(capped.limited, true);
  assert.equal(capped.models.length, 3);
});

test('원본 팝업 가림 보정은 선택한 위치를 상단 가용 영역으로 옮긴다', () => {
  const bounds = { south: 37, north: 38, west: 126, east: 127 };
  const viewport = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
  const panel = { left: 0, top: 400, right: 800, bottom: 600, width: 800, height: 200 };
  const center = globalThis.CarePopupGeometry.focusCenter({ lat: 37.5, lng: 126.5 }, bounds, viewport, panel);
  assert.ok(center.lat < 37.5, '남쪽으로 중심을 이동하면 선택 마커가 화면 위쪽에 배치된다');
  assert.equal(center.lng, 126.5);
});

test('원본 라벨 배치는 위쪽 공간이 막혀도 핀을 옮기지 않고 오른쪽을 사용한다', () => {
  const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
  const pin = rect(120, 75, 40, 40);
  const label = rect(90, 40, 100, 24);
  const obstacle = rect(85, 36, 115, 32);
  const result = globalThis.CareMarkerPlacement.fit([label], pin, rect(0, 0, 450, 300), [obstacle]);
  assert.equal(result.side, 'right');
  assert.deepEqual(pin, rect(120, 75, 40, 40));
});

test('재사용한 두 파일이 원본 Git blob과 일치하여 출처 기록을 검증할 수 있다', () => {
  for (const [name, expected] of Object.entries({ 'care-popup-geometry.js': '86d69f3b08f6e90c41eeecc4595b52880046e0cd', 'map-marker-placement.js': '76176ec5fd0470806036a0a295ef3de8c5af193a' })) {
    const bytes = readFileSync(new URL(`../public/vendor/homecare/${name}`, import.meta.url));
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(actual, expected, name);
  }
});
/** SOFTM-EV-MAP-TEST END */

test('돌봄한눈 배율 단계에 맞춰 점·핀·이름·상세 레벨을 나눈다', () => {
  assert.deepEqual([10, 13, 14, 15, 16, 17, 18, 19].map(markerScale), ['dot','dot','pin','pin','name','name','detail','detail']);
  assert.equal(labelBudget(12,800,600), 0);
  assert.ok(labelBudget(12,800,600) <= labelBudget(16,800,600));
  assert.ok(labelBudget(18,800,600) <= 40);
});
