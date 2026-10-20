import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, access, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compressRegionFiles } from '../scripts/compress-data.mjs';
import { decodeJsonData } from '../public/js/data.js';

const prefix = 'releases/20261020T120000-abcdef0123/regions/';

test('Pages build gzip-compresses immutable JSON shards and preserves metadata', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'evcharger-gzip-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'data');
  const original = path.join(root, ...((prefix + '11.json').split('/')));
  await mkdir(path.dirname(original), { recursive: true });
  const region = { schemaVersion: 1, regionCode: '11', stations: [{
    id: 'ME00001', name: '충전소'.repeat(1000), address: '서울특별시', chargers: [{ id: '01', type: '04', status: '2' }]
  }] };
  await writeFile(original, JSON.stringify(region));
  const manifest = { schemaVersion: 1, mode: 'snapshot', regions: [{
    code: '11', path: prefix + '11.json', stationCount: 1, chargerCount: 1
  }] };
  const result = await compressRegionFiles(root, manifest);
  assert.equal(result.gzipRegions, 1);
  assert.ok(result.savedBytes > 0);
  assert.equal(manifest.regions[0].path, prefix + '11.json.gz');
  assert.equal(manifest.regions[0].encoding, 'gzip');
  assert.ok(manifest.regionStorage.savedBytes > 0);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(original + '.gz')).toString()), region);
  await assert.rejects(access(original));
});

test('Tiny region stays JSON when gzip increases transfer size', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'evcharger-tiny-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'data');
  const original = path.join(root, ...((prefix + '99.json').split('/')));
  await mkdir(path.dirname(original), { recursive: true });
  await writeFile(original, '{}');
  const manifest = { schemaVersion: 1, regions: [{ code: '99', path: prefix + '99.json' }] };
  const result = await compressRegionFiles(root, manifest);
  assert.equal(result.gzipRegions, 0);
  assert.equal(manifest.regions[0].path, prefix + '99.json');
  assert.equal(await readFile(original, 'utf8'), '{}');
});

test('Unsafe manifest region path is rejected', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'evcharger-traversal-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await assert.rejects(compressRegionFiles(temp, { schemaVersion: 1, regions: [{ code: '11', path: '../private.json' }] }), /Unsafe/);
});

test('Parser handles gzip, plain JSON and CDN already-decoded responses', async () => {
  const region = { schemaVersion: 1, regionCode: '11', stations: [{ id: '000001', chargers: [] }] };
  const bytes = Buffer.from(JSON.stringify(region));
  assert.deepEqual(await decodeJsonData(new Response(gzipSync(bytes))), region);
  assert.deepEqual(await decodeJsonData(new Response(bytes)), region);
  assert.deepEqual(await decodeJsonData(new Response(bytes, { headers: { 'Content-Encoding': 'gzip' } })), region);
  await assert.rejects(decodeJsonData(new Response(Buffer.from('not JSON'))), /해석/);
  await assert.rejects(decodeJsonData(new Response(Buffer.from('{}'))), /형식/);
});
