import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { compressRegionFiles } from './compress-data.mjs';
import { buildSearchIndex } from './build-search-index.mjs';
import { versionAssets } from './version-assets.mjs';
import { buildAdConfig } from './ad-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, 'public'), output, { recursive: true, filter: p => !/\.(?:DS_Store|pyc)$/.test(p) });
await versionAssets(output, process.env.GITHUB_SHA || 'local');
const context = { window: {} };
vm.runInNewContext(await readFile(path.join(root, 'public/config.js'), 'utf8'), context);
const config = { ...context.window.EV_CONFIG };
const variables = { PUBLIC_NAVER_MAP_CLIENT_ID: 'naverMapClientId', PUBLIC_EV_API_BASE_URL: 'apiBaseUrl', PUBLIC_EV_DATA_BASE_URL: 'dataBaseUrl', PUBLIC_EV_STATUS_API_BASE_URL:'statusApiBaseUrl' };
for (const [key, field] of Object.entries(variables)) {
  // Blank Actions variables must preserve source defaults. Use DISABLE_NAVER_MAP=true to disable explicitly.
  if (process.env[key]) config[field] = process.env[key];
}
if (process.env.DISABLE_NAVER_MAP === 'true') config.naverMapClientId = '';
for (const key of ['apiBaseUrl', 'dataBaseUrl','statusApiBaseUrl']) {
  const value = config[key] || '';
  if (/^(?:javascript|data):/i.test(value) || /[\r\n]/.test(value)) throw new Error(`Invalid public URL setting: ${key}`);
  if (/servicekey|apikey|token=/i.test(value)) throw new Error(`Secret-like parameter in public URL setting: ${key}`);
}
await writeFile(path.join(output, 'config.js'), `/* Public settings only. */\nwindow.EV_CONFIG = Object.freeze(${JSON.stringify(config, null, 2)});\n`);
vm.runInNewContext(await readFile(path.join(root, 'public/ad-config.js'), 'utf8'), context);
const adConfig = buildAdConfig(context.window.EV_AD_CONFIG,process.env);
await writeFile(path.join(output, 'ad-config.js'), `/* Public AdFit configuration. */\nwindow.EV_AD_CONFIG = Object.freeze(${JSON.stringify(adConfig, null, 2)});\n`);
console.log(`AdFit: ${adConfig.enabled ? Object.values(adConfig.units).filter(slot=>slot.unit).length : 0} configured units; actual serving is not verified by a build. Welcome popup ad requests remain disabled.`);
const manifest = JSON.parse(await readFile(path.join(output, 'data/manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.regions)) throw new Error('Invalid data manifest');
const compression = await compressRegionFiles(path.join(output, 'data'), manifest);
const searchIndex = await buildSearchIndex(path.join(output, 'data'), manifest);
await writeFile(path.join(output, 'data/manifest.json'), JSON.stringify(manifest) + '\n');
await writeFile(path.join(output, 'build-info.json'), JSON.stringify({version:'0.1.0',builtAt:new Date().toISOString(),sourceRevision:process.env.GITHUB_SHA||null,dataMode:manifest.mode,scheduledCollectionEnabled:process.env.SCHEDULED_COLLECTION_ENABLED==='true'},null,2)+'\n');
console.log(`Built dist/ — ${manifest.mode}, ${manifest.totalStations || 0} stations. Region bytes ${compression.originalBytes} -> ${compression.publishedBytes}, gzip ${compression.gzipRegions}/${compression.regions}. No API secret is bundled.`);
console.log(`National search: ${searchIndex.stationCount} stations, ${searchIndex.originalBytes} -> ${searchIndex.publishedBytes} bytes.`);
