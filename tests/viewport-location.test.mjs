import test from 'node:test';
import assert from 'node:assert/strict';
import { filterStationsToBounds, sameMapBounds } from '../public/js/data.js';
import { getBrowserLocation, locationMessage } from '../public/js/location.js';

test('map viewport counts only stations inside its exact bounds', () => {
  const bounds = { south: 37.44, north: 37.51, west: 126.68, east: 126.79 };
  const stations = [
    { id: 'INSIDE', lat: 37.48, lng: 126.71 },
    { id: 'EDGE', lat: 37.44, lng: 126.79 },
    { id: 'OUTSIDE', lat: 37.56, lng: 126.96 },
    { id: 'MISSING', lat: null, lng: null },
    { id: 'INVALID', lat: NaN, lng: 0 }
  ];
  assert.deepEqual(filterStationsToBounds(stations, bounds).map(station => station.id), ['INSIDE', 'EDGE']);
  assert.deepEqual(filterStationsToBounds(stations, { south: 37.54, north: 37.59, west: 126.9, east: 127 }).map(station => station.id), ['OUTSIDE']);
  assert.equal(sameMapBounds(bounds, { ...bounds, south: 37.4400001 }), true);
  assert.equal(sameMapBounds(bounds, { ...bounds, south: 37.6 }), false);
  assert.deepEqual(filterStationsToBounds(stations, { south: 39, north: 38, west: 126, east: 127 }), []);
});

test('initial permitted position resolves before map and data startup', async () => {
  const calls = [];
  const env = { isSecureContext: true, navigator: {
    permissions: { query: async () => { calls.push('permission'); return { state: 'granted' }; } },
    geolocation: { getCurrentPosition(ok) { calls.push('location'); ok({ coords: { latitude: 37.45, longitude: 126.70 } }); } }
  } };
  assert.deepEqual(await getBrowserLocation({ env }), { point: { lat: 37.45, lng: 126.70 }, reason: '' });
  assert.deepEqual(calls, ['permission', 'location']);
});

test('blocked geolocation does not repeatedly ask user for permission', async () => {
  let requested = 0;
  const env = { isSecureContext: true, navigator: {
    permissions: { query: async () => ({ state: 'denied' }) },
    geolocation: { getCurrentPosition() { requested += 1; } }
  } };
  assert.deepEqual(await getBrowserLocation({ env }), { point: null, reason: 'denied' });
  assert.equal(requested, 0);
  assert.match(locationMessage('denied'), /권한/);
});

test('temporary timeout retries once with high accuracy', async () => {
  const requestedAccuracy = [];
  const env = { isSecureContext: true, navigator: { geolocation: {
    getCurrentPosition(resolve, reject, options) {
      requestedAccuracy.push(options.enableHighAccuracy);
      if (options.enableHighAccuracy) resolve({ coords: { latitude: 37.566, longitude: 126.978 } });
      else reject({ code: 3 });
    }
  } } };
  assert.deepEqual((await getBrowserLocation({ env })).point, { lat: 37.566, lng: 126.978 });
  assert.deepEqual(requestedAccuracy, [false, true]);
});

test('unavailable, blocked and overseas browser positions fall back safely', async () => {
  const overseas = { isSecureContext: true, navigator: { geolocation: {
    getCurrentPosition(ok) { ok({ coords: { latitude: 48, longitude: 2 } }); }
  } } };
  assert.deepEqual(await getBrowserLocation({ env: overseas }), { point: null, reason: 'outside' });
  assert.deepEqual(await getBrowserLocation({ env: { isSecureContext: false } }), { point: null, reason: 'insecure' });
  assert.deepEqual(await getBrowserLocation({ env: { isSecureContext: true, navigator: {} } }), { point: null, reason: 'unsupported' });
});
