import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';
import { summarizeCollection } from '../public/js/data-status-model.js';

const rawUrl = process.env.DEPLOYMENT_URL || process.argv[2];
if (!rawUrl) throw new Error('Set DEPLOYMENT_URL or provide the published app URL.');
const base = new URL(rawUrl.endsWith('/') ? rawUrl : `${rawUrl}/`);
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
  throw new Error('Deployment URL must be a public HTTP(S) path without credentials or query parameters.');
}
const expectedRevision = process.env.EXPECTED_REVISION || '';
const attempts = Number(process.env.DEPLOYMENT_CHECK_ATTEMPTS || 8);
if (!Number.isInteger(attempts) || attempts < 1 || attempts > 12) throw new Error('Invalid retry count.');

async function get(resource, json = false) {
  const url = new URL(resource, base);
  // Ask the CDN for the currently published release, not a cached previous build.
  url.searchParams.set('verify', `${expectedRevision.slice(0, 12) || 'current'}-${Date.now()}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw new Error(`${resource}: HTTP ${response.status}`);
  return json === 'bytes' ? new Uint8Array(await response.arrayBuffer()) : json ? response.json() : response.text();
}

async function verify() {
  const [html, build, manifest, fees, app, css, statusPage, statusScript, statusCss] = await Promise.all([
    get('./'), get('build-info.json', true), get('data/manifest.json', true), get('data/fees.json', true), get('js/app.js'), get('css/app.css'),
    get('data-status.html'), get('js/data-status.js'), get('css/data-status.css')
  ]);
  if (!html.includes('id="appLayout"') || !html.includes('./js/app.js')) throw new Error('Published root is not the charging app.');
  if (!build.sourceRevision) throw new Error('Published build has no source revision.');
  if (expectedRevision && build.sourceRevision !== expectedRevision) throw new Error('Published revision does not match this workflow.');
  if (!app.includes('new DataClient(') || !css.includes('.app-layout')) throw new Error('Published application assets are missing.');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.regions)) throw new Error('Published data manifest is invalid.');
  if (!html.includes('./data-status.html') || !statusPage.includes('id="dataSummary"')
      || !statusPage.includes('./js/data-status.js') || !statusScript.includes('summarizeCollection')
      || !statusCss.includes('.metrics')) throw new Error('Mandatory data status page or its entry link/assets are missing.');
  if (summarizeCollection(manifest).problems.length) throw new Error('Published collection totals do not match regional results.');
  if (typeof build.scheduledCollectionEnabled !== 'boolean') throw new Error('Published collection schedule setting is missing.');
  if (fees.schemaVersion !== 1 || fees.currency !== 'KRW' || fees.unit !== 'kWh' || !Array.isArray(fees.operators)
      || fees.operators.some(operator => !operator.operatorId || !Array.isArray(operator.rates))) {
    throw new Error('Published tariff guidance JSON is invalid.');
  }
  if (manifest.dataCompleteness) {
    for (const [group, values] of Object.entries(manifest.dataCompleteness)) {
      const total = group === 'charger' ? manifest.totalChargers : manifest.totalStations;
      for (const count of Object.values(values)) {
        if (!Number.isInteger(count) || count < 0 || count > total) throw new Error('Published completeness counts are invalid.');
      }
    }
  }
  if (!['unconfigured', 'snapshot', 'live'].includes(manifest.mode) || build.dataMode !== manifest.mode) {
    throw new Error('Published build and production data modes disagree.');
  }
  if (manifest.mode === 'unconfigured' && (manifest.totalStations !== 0 || manifest.totalChargers !== 0 || manifest.regions.length)) {
    throw new Error('Unconfigured production must not contain example stations.');
  }
  if (manifest.regions.length) {
    // Do not accept a green deploy when a shard is missing or gzip JSON is invalid.
    const entry = [...manifest.regions].sort((a, b) => a.chargerCount - b.chargerCount)[0];
    const bytes = await get('data/' + entry.path, 'bytes');
    const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const region = JSON.parse(new TextDecoder().decode(gz ? gunzipSync(bytes) : bytes));
    if (region.schemaVersion !== 1 || String(region.regionCode) !== String(entry.code)
        || !Array.isArray(region.stations) || region.stations.length !== entry.stationCount) {
      throw new Error('Published region data does not match its manifest.');
    }
    if (entry.encoding === 'gzip' && !entry.path.endsWith('.json.gz')) {
      throw new Error('Compressed region path does not match its encoding.');
    }
  }
  if (manifest.mode === 'unconfigured') console.warn('Site is published; official data remains unconfigured.');
  console.log(JSON.stringify({ url: base.href, sourceRevision: build.sourceRevision, dataMode: manifest.mode,
    stations: manifest.totalStations, chargers: manifest.totalChargers,
    tariffs: fees.operators.length, feeMode: fees.mode,
    completeness: manifest.dataCompleteness || null,
    regionStorage: manifest.regionStorage || null, verifiedAt: new Date().toISOString() }));
}

for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    await verify();
    break;
  } catch (error) {
    if (attempt === attempts) throw error;
    console.warn(`Published app check ${attempt}/${attempts}: ${error.message}. Retrying after CDN propagation.`);
    await delay(10_000);
  }
}
