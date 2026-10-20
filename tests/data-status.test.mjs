import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCollection, verifyRegionCounts } from '../public/js/data-status-model.js';

const now = Date.parse('2026-10-20T11:40:00Z');
const fixture = () => ({schemaVersion:1,mode:'snapshot',generatedAt:'2026-10-20T03:29:57Z',totalStations:1,totalChargers:2,freshnessThresholdSeconds:600,statusCoverageAt:'2026-10-20T03:29:57Z',regions:[{code:'44',stationCount:1,chargerCount:2}],regionStorage:{originalBytes:1000,publishedBytes:100,gzipRegions:1}});

test('collected inventory remains present while old charger status is explicitly stale', () => {
  const summary = summarizeCollection(fixture(), now);
  assert.equal(summary.hasData, true);
  assert.equal(summary.statusFresh, false);
  assert.equal(summary.saving, 90);
  assert.deepEqual(summary.problems, []);
});

test('only recent continuous coverage can show fresh status, including rejection of future dates', () => {
  const manifest = fixture();
  manifest.statusCoverageAt = '2026-10-20T11:39:00Z';
  assert.equal(summarizeCollection(manifest, now).statusFresh, true);
  manifest.statusCoverageAt = '2026-10-20T12:39:00Z';
  assert.equal(summarizeCollection(manifest, now).statusFresh, false);
});

test('missing files and inconsistent regional totals cannot be reported as verified collection', () => {
  const manifest = fixture();
  manifest.totalStations = 2;
  manifest.regions[0].complete = false;
  assert.equal(summarizeCollection(manifest, now).problems.length, 2);
  manifest.totalChargers = undefined;
  assert.equal(summarizeCollection(manifest, now).problems.length, 3);
});

test('unconfigured data has no fabricated collection result or compression savings', () => {
  const result = summarizeCollection({mode:'unconfigured',totalStations:0,totalChargers:0,regions:[]}, now);
  assert.equal(result.hasData, false);
  assert.equal(result.saving, null);
  assert.equal(result.original, null);
  assert.equal(result.collectedAt, null);
  assert.deepEqual(result.problems, []);
});

test('actual file validation counts multi-connector chargers once and detects partial shards', () => {
  const entry = {stationCount:1,chargerCount:2};
  const region = {stations:[{chargers:[{id:'01',type:'06'},{id:'02',type:'04'}]}],complete:true};
  assert.deepEqual(verifyRegionCounts(entry, region), {stations:1,chargers:2,valid:true});
  assert.equal(verifyRegionCounts({...entry,chargerCount:3}, region).valid, false);
  assert.equal(verifyRegionCounts(entry, {...region,complete:false}).valid, false);
});
