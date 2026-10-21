import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {packSearchStation,unpackSearchIndex} from '../public/js/national-search.js';

export async function buildSearchIndex(directory, manifest) {
  const root = path.resolve(directory);
  const index = {schemaVersion:1,kind:'station-search',fieldsVersion:1,generatedAt:manifest.generatedAt || null,
    totalStations:0,totalChargers:0,regions:[],stations:[]};
  for (const entry of manifest.regions) {
    if (!/^releases\/\d{8}T\d{6}-[a-f0-9]{10}\/regions\/[A-Za-z0-9_-]{1,64}\.json(?:\.gz)?$/.test(entry.path || '')) throw new Error('Unsafe search source path.');
    const bytes = await readFile(path.join(root,...entry.path.split('/')));
    const region = JSON.parse((bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString('utf8'));
    if (region.schemaVersion !== 1 || String(region.regionCode) !== String(entry.code) || !Array.isArray(region.stations)
      || region.stations.length !== entry.stationCount || region.stations.reduce((n,s)=>n+(s.chargers || []).length,0) !== entry.chargerCount) throw new Error('National search source counts disagree with manifest.');
    if (manifest.mode !== 'demo' && region.mode === 'demo') throw new Error('Demo records cannot enter the production search index.');
    index.regions.push({regionCode:String(region.regionCode),mode:region.mode,generatedAt:region.generatedAt,
      inventoryUpdatedAt:region.inventoryUpdatedAt,statusCoverageAt:region.statusCoverageAt,complete:region.complete});
    for (const station of region.stations) {
      if (String(station.regionCode) !== String(entry.code)) throw new Error('National search station belongs to a different region.');
      index.stations.push(packSearchStation(station));
      index.totalChargers += (station.chargers || []).length;
    }
  }
  index.totalStations = index.stations.length;
  // Validate the exact contract used by the browser before publishing a new index.
  unpackSearchIndex(index,{stationCount:manifest.totalStations || 0,chargerCount:manifest.totalChargers || 0});
  const plain = Buffer.from(JSON.stringify(index));
  const compressed = gzipSync(plain,{level:6});
  const hash = createHash('sha256').update(plain).digest('hex').slice(0,20);
  const filename = `stations-${hash}.json.gz`;
  const folder = path.join(root,'search');
  await rm(folder,{recursive:true,force:true});
  await mkdir(folder,{recursive:true});
  await writeFile(path.join(folder,filename),compressed);
  manifest.searchIndex = {path:`search/${filename}`,encoding:'gzip',fieldsVersion:1,
    stationCount:index.totalStations,chargerCount:index.totalChargers,originalBytes:plain.length,publishedBytes:compressed.length};
  return manifest.searchIndex;
}
