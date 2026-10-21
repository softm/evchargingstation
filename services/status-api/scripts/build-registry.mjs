import {writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';

// Only a registry of actual, published stations can spend an upstream API call.
const base = new URL('https://softm.github.io/evchargingstation/data/');
async function read(url,limit) {
  const res = await fetch(url,{signal:AbortSignal.timeout(30000),redirect:'error'});
  if (!res.ok) throw new Error('Published inventory unavailable');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > limit) throw new Error('Inventory size exceeded');
  return buffer;
}
const manifest = JSON.parse((await read(new URL('manifest.json',base),2e6)).toString());
const url = new URL(manifest.searchIndex?.path || '',base);
if (manifest.mode === 'demo' || manifest.schemaVersion !== 1 || !manifest.searchIndex || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('Verified national index required');
let buffer = await read(url,20e6);
if (buffer[0] === 0x1f && buffer[1] === 0x8b) buffer = gunzipSync(buffer,{maxOutputLength:100e6});
const data = JSON.parse(buffer.toString());
if (data.schemaVersion !== 1 || data.kind !== 'station-search' || data.fieldsVersion !== 1 || data.stations.length !== manifest.totalStations || data.totalChargers !== manifest.totalChargers) throw new Error('Inventory counts mismatch');
const stations = Object.create(null);
for (const row of data.stations) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(row[0]) || !/^\d{2}$/.test(row[1]) || Object.hasOwn(stations,row[0])) throw new Error('Invalid station registry');
  stations[row[0]] = [row[1],row[7]];
}
await writeFile(new URL('../lib/stations.json',import.meta.url),JSON.stringify({collectedAt:manifest.inventoryUpdatedAt,stations}));
await mkdir(new URL('../public/',import.meta.url),{recursive:true});
await writeFile(new URL('../public/index.html',import.meta.url),'<!doctype html><html lang="ko"><meta charset="utf-8"><title>충전소 상태 조회 서버</title><p>충전소 상태 조회 서버</p><a href="https://softm.github.io/evchargingstation/data-status.html">수집 및 서버 현황 확인</a></html>');
console.log(`Verified ${Object.keys(stations).length} published stations for status lookup.`);
