import { intersects } from './domain.js';


/** Pages .json.gz is raw gzip; some CDNs transparently decode Content-Encoding. */
export async function decodeJsonData(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const gzip = bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (gzip && typeof DecompressionStream !== 'function') {
    throw new Error('압축된 충전소 정보를 읽으려면 브라우저를 최신 버전으로 업데이트해 주세요.');
  }
  const text = gzip
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(bytes);
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('충전소 데이터 파일을 해석할 수 없습니다.'); }
  if (!data || data.schemaVersion !== 1) throw new Error('데이터 형식을 확인할 수 없습니다.');
  return data;
}

export class DataClient {
  constructor(config = {}) {
    this.base = new URL(`${String(config.apiBaseUrl || config.dataBaseUrl || './data').replace(/\/$/, '')}/`, location.href);
    this.cache = new Map();
  }

  async request(path, signal) {
    const url = new URL(path, this.base);
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname)) throw new Error('지원하지 않는 데이터 경로입니다.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), path === 'manifest.json' ? 15000 : 30000);
    const abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(url, {
        cache: path === 'manifest.json' ? 'no-store' : 'default',
        signal: controller.signal,
        headers: { Accept: 'application/json, application/gzip' },
      });
      if (!response.ok) throw new Error('데이터를 불러오지 못했습니다. (' + response.status + ')');
      return await decodeJsonData(response);
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.');
      throw error;
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }

  async manifest(signal) {
    const value = await this.request('manifest.json', signal);
    if (!Array.isArray(value.regions)) throw new Error('지역 정보가 올바르지 않습니다.');
    return value;
  }

  async region(entry, { force = false, signal } = {}) {
    const code = String(entry.code);
    const cacheKey = `${code}:${entry.path}`;
    if (!force && this.cache.has(cacheKey)) return this.cache.get(cacheKey);
    const data = await this.request(entry.path, signal);
    if (!Array.isArray(data.stations) || String(data.regionCode) !== code) throw new Error('지역 충전소 정보를 확인할 수 없습니다.');
    const normalized = { ...data, regionCode: code, stations: data.stations.map(station => ({ ...station, id: String(station.id), regionCode: String(station.regionCode), chargers: (station.chargers || []).map(charger => ({ ...charger, id: String(charger.id), type: String(charger.type).padStart(2, '0'), status: String(charger.status ?? '0') })) })) };
    for (const key of this.cache.keys()) if (key.startsWith(`${code}:`) && key !== cacheKey) this.cache.delete(key);
    this.cache.set(cacheKey, normalized);
    return normalized;
  }
}

export function selectViewportRegions(regions, bounds, limit = 4) {
  if (!bounds) return [];
  const center = { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
  const matches = regions.filter(region => intersects(bounds, region.bounds));
  return matches.sort((a, b) => {
    const score = region => Math.abs((region.bounds.south + region.bounds.north) / 2 - center.lat) + Math.abs((region.bounds.west + region.bounds.east) / 2 - center.lng);
    return score(a) - score(b);
  }).slice(0, limit);
}
