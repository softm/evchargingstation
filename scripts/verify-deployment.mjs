import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';
import { summarizeCollection } from '../public/js/data-status-model.js';
import { validAdUnit } from '../public/js/ads.js';
import { unpackSearchIndex } from '../public/js/national-search.js';
import vm from 'node:vm';
import {buildAdConfig} from './ad-config.mjs';

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
  const [html, build, manifest, fees, app, css, statusPage, statusScript, statusCss, layoutCss, ads, adCss, adConfig, privacy, detailScript, detailCss] = await Promise.all([
    get('./'), get('build-info.json', true), get('data/manifest.json', true), get('data/fees.json', true), get('js/app.js'), get('css/app.css'),
    get('data-status.html'), get('js/data-status.js'), get('css/data-status.css'), get('css/layout.css'),
    get('js/ads.js'), get('css/ads.css'), get('ad-config.js'), get('privacy.html'), get('js/station-details.js'), get('css/details.css')
  ]);
  if (!html.includes('id="appLayout"') || !html.includes('./js/app.js')) throw new Error('Published root is not the charging app.');
  if (!build.sourceRevision) throw new Error('Published build has no source revision.');
  if (expectedRevision && build.sourceRevision !== expectedRevision) throw new Error('Published revision does not match this workflow.');
  if (expectedRevision && !html.includes(`./js/app.js?v=${expectedRevision}`)) throw new Error('Published entrypoint has no release cache version.');
  if (!app.includes('new DataClient(') || !css.includes('.app-layout')) throw new Error('Published application assets are missing.');
  if (!html.includes('./css/layout.css') || !html.includes('id="filterDialog"') || !layoutCss.includes('.filter-dialog')) {
    throw new Error('Published sidebar layout or filter panel assets are missing.');
  }
  if (!html.includes('./css/details.css') || !detailScript.includes('stationStatusCounts')
      || !detailScript.includes('chargerRowsHTML') || !detailCss.includes('.detail-status-grid')
      || !app.includes('chargingHelpHTML') || !statusPage.includes('id="tariffSummary"')) {
    throw new Error('Published charging detail guidance or tariff coverage assets are missing.');
  }
  const adContext={window:{}};vm.runInNewContext(adConfig,adContext);
  const publishedAds=buildAdConfig(adContext.window.EV_AD_CONFIG,{});
  const adUnit=publishedAds.units.list1.unit;
  const [adList,adBottom,adWelcome]=await Promise.all([get('js/ad-list.js'),get('js/ad-bottom.js'),get('js/ad-welcome.js')]);
  if (!html.includes('id="adfitBanner"') || !html.includes('./ad-config.js') || !html.includes('./css/ads.css')
      || !ads.includes('mountAdBanner') || !adCss.includes('.adfit-banner')
      || !app.includes('listAds.render(') || !adList.includes('mountListAds') || !adBottom.includes('mountBottomAd') || !adWelcome.includes('mountWelcome')
      || !html.includes('id="bottomAd"') || !html.includes('id="welcomeAdDialog"') || !privacy.includes('카카오 AdFit')
      || typeof adUnit !== 'string' || (adUnit && !validAdUnit(adUnit))) throw new Error('Published AdFit integration assets/configuration are missing or invalid.');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.regions)) throw new Error('Published data manifest is invalid.');
  if (!html.includes('./data-status.html') || !statusPage.includes('id="dataSummary"')
      || !statusPage.includes('./js/data-status.js') || !statusScript.includes('summarizeCollection')
      || !statusCss.includes('.metrics')) throw new Error('Mandatory data status page or its entry link/assets are missing.');
  if (summarizeCollection(manifest).problems.length) throw new Error('Published collection totals do not match regional results.');
  if (!manifest.searchIndex || !/^search\/stations-[a-f0-9]{20}\.json\.gz$/.test(manifest.searchIndex.path)
      || manifest.searchIndex.stationCount !== manifest.totalStations || manifest.searchIndex.chargerCount !== manifest.totalChargers
      || !app.includes('loadNationwide')) throw new Error('Published nationwide search assets or counts are missing.');
  const searchBytes = await get('data/' + manifest.searchIndex.path,'bytes');
  const searchData = JSON.parse(new TextDecoder().decode(searchBytes[0] === 0x1f && searchBytes[1] === 0x8b ? gunzipSync(searchBytes) : searchBytes));
  unpackSearchIndex(searchData,manifest.searchIndex);
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
    regionStorage: manifest.regionStorage || null, adFitConfigured:publishedAds.enabled&&Object.values(publishedAds.units).some(slot=>validAdUnit(slot.unit)),adFitConfiguredPlacements:Object.entries(publishedAds.units).filter(([,slot])=>slot.unit).map(([name])=>name),welcomeAdRequestsEnabled:false, verifiedAt: new Date().toISOString() }));
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
