import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerState, summarizeStation, chargerMatches, filterStations, confirmation, typeInfo, distanceKm, insideMapBounds, powerBand, POWER_BANDS, safePhone, csvCell } from '../public/js/domain.js';
import { selectViewportRegions } from '../public/js/data.js';

const now = Date.parse('2026-10-19T15:00:00Z');
const charger = (overrides = {}) => ({ id: '01', type: '04', status: '2', outputKw: 100, observedAt: '2026-10-19T14:59:00Z', statusChangedAt: '2026-10-10T00:00:00Z', ...overrides });

test('only freshly confirmed waiting status is available, including reserved and unconfirmed codes', () => {
  assert.equal(chargerState(charger(), {}, now).available, true);
  for (const status of ['0', '1', '3', '4', '5', '6', '9', '99']) assert.equal(chargerState(charger({ status }), {}, now).available, false, status);
  assert.equal(chargerState(charger({ status: '6' }), {}, now).label, '예약 중');
  assert.equal(chargerState(charger({ status: '9' }), {}, now).label, '상태 미확인');
});

test('status changed timestamp is not used as confirmation; missing and stale heartbeats fail closed', () => {
  assert.equal(chargerState(charger({ observedAt: null, statusChangedAt: '2026-10-19T14:59:00Z' }), {}, now).available, false);
  assert.equal(chargerState(charger({ observedAt: '2026-10-19T14:40:00Z' }), {}, now).available, false);
  assert.equal(chargerState(charger({ observedAt: '2026-10-19T14:50:00Z' }), {}, now).available, true);
  assert.equal(chargerState(charger({ observedAt: '2026-10-19T14:49:59Z' }), {}, now).available, false);
});

test('complete coverage can confirm an unchanged old charger, invalid future coverage does not', () => {
  const old = charger({ observedAt: '2026-10-19T13:00:00Z' });
  assert.equal(chargerState(old, { statusCoverageAt: '2026-10-19T14:58:00Z' }, now).available, true);
  assert.equal(chargerState(old, { complete: false, statusCoverageAt: '2026-10-19T14:58:00Z' }, now).available, false);
  assert.equal(chargerState(old, { statusCoverageAt: '2026-10-19T14:45:00Z' }, now).available, false);
  assert.equal(chargerState(old, { statusCoverageAt: '2026-10-20T00:00:00Z' }, now).available, false);
  assert.equal(chargerState(charger({ observedAt: 'invalid' }), { statusCoverageAt: null }, now).available, false);
  assert.equal(confirmation(charger({ observedAt: '2026-10-20T00:00:00Z' }), {}, now).futureTimestamp, true);
});

test('connector, minimum output and waiting status must match the same charger', () => {
  const station = { id: '0000123', name: '동일 충전기 검사', regionCode: '11', chargers: [charger({ type: '02', outputKw: 7 }), charger({ id: '02', type: '04', outputKw: 200, status: '3' })] };
  const filters = { connector: 'combo', minPower: 100, available: true };
  assert.deepEqual(filterStations([station], {}, filters, new Set(), now), []);
  assert.equal(summarizeStation(station, {}, filters, now).available, 0);
  assert.equal(chargerMatches(charger({ outputKw: null }), { minPower: 50 }, {}, now), false);
  station.chargers[1].status = '2';
  assert.equal(filterStations([station], {}, filters, new Set(), now)[0].id, '0000123');
});

test('multi-connector equipment counts once and bus-only connector stays distinct', () => {
  const station = { chargers: [charger({ type: '10' })] };
  assert.equal(typeInfo('10').name, 'DC콤보 + NACS');
  assert.equal(chargerMatches(charger({ type: '10' }), { connector: 'nacs' }, {}, now), true);
  assert.equal(chargerMatches(charger({ type: '11' }), { connector: 'combo' }, {}, now), false);
  assert.equal(typeInfo('11').busOnly, true);
  assert.equal(summarizeStation(station, {}, {}, now).total, 1);
  assert.equal(summarizeStation(station, {}, {}, now).available, 1);
  assert.equal(summarizeStation({ chargers: [charger({ status: '9' })] }, {}, {}, now).tone, 'unknown');
});

test('unknown parking/restrictions cannot pass affirmative filters; favorites preserve zero-prefixed IDs', () => {
  const station = { id: '0000123', name: '종로 충전소', address: '서울특별시', regionCode: '11', restricted: null, parkingFree: null, chargers: [charger()] };
  assert.deepEqual(filterStations([station], {}, { unrestricted: true }, new Set(), now), []);
  assert.deepEqual(filterStations([station], {}, { freeParking: true }, new Set(), now), []);
  assert.equal(filterStations([station], {}, { favorites: true, query: '종로' }, new Set(['0000123']), now).length, 1);
  assert.equal(filterStations([station], {}, { favorites: true }, new Set(['123']), now).length, 0);
});

test('a wide map loads at most the allowed nearest regions', () => {
  const regions = Array.from({ length: 10 }, (_, i) => ({ code: String(i), bounds: { south: i, north: i + 1, west: 0, east: 1 } }));
  const chosen = selectViewportRegions(regions, { south: 0, north: 10, west: 0, east: 2 }, 4);
  assert.equal(chosen.length, 4);
  assert.equal(chosen.some(region => region.code === '0'), false);
  assert.deepEqual(selectViewportRegions(regions, { south: 20, north: 30, west: 0, east: 2 }), []);
});

test('coordinates, phone links and CSV reject unsafe values', () => {
  assert.equal(distanceKm({ lat: 37.5, lng: 127 }, { lat: null, lng: null }), Infinity);
  assert.equal(distanceKm({ lat: 37.5, lng: 127 }, { lat: 0, lng: 0 }), Infinity);
  assert.equal(distanceKm({ lat: 37.5, lng: 127 }, { lat: 37.5, lng: 127 }), 0);
  assert.equal(safePhone('1661-9408'), '16619408');
  assert.equal(safePhone('javascript:alert(1)'), '');
  assert.equal(csvCell('=HYPERLINK("evil")'), '"\'=HYPERLINK(""evil"")"');
  assert.equal(csvCell('정상,주소'), '"정상,주소"');
});

test('map viewport excludes outside stations before availability summaries', () => {
  const box = { south: 37.4, north: 37.6, west: 126.8, east: 127.1 };
  assert.equal(insideMapBounds({ lat: 37.5, lng: 127 }, box), true);
  assert.equal(insideMapBounds({ lat: 35.5, lng: 127 }, box), false);
  assert.equal(insideMapBounds({ lat: null, lng: 127 }, box), false);
  assert.equal(insideMapBounds({ lat: 37.4, lng: 126.8 }, box), true);
});

test('power bands follow the five supplied kW intervals', () => {
  for (const [kw, band] of [[7,'slow'],[29.99,'slow'],[30,'medium'],[49.9,'medium'],[50,'fast'],[99.9,'fast'],[100,'fastPlus'],[199.99,'fastPlus'],[200,'ultra'],[350,'ultra']]) {
    assert.equal(powerBand(kw), band, String(kw));
    assert.ok(POWER_BANDS[band]);
  }
  assert.equal(powerBand(null), null);
});

test('map status color categories honor verified time and restricted use', () => {
  const station = overrides => ({ chargers: [charger(overrides)], restricted: false });
  assert.equal(summarizeStation(station({status:'2'}), {}, {}, now).tone, 'available');
  assert.equal(summarizeStation(station({status:'3'}), {}, {}, now).tone, 'charging');
  assert.equal(summarizeStation(station({status:'4'}), {}, {}, now).tone, 'unavailable');
  assert.equal(summarizeStation(station({status:'2',observedAt:'2026-10-19T13:00:00Z'}), {}, {}, now).tone, 'unknown');
  assert.equal(summarizeStation({ ...station({status:'2'}), restricted: true }, {}, {}, now).tone, 'restricted');
});
