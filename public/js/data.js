import { intersects } from './domain.js';

/**
 * Regional map search envelopes (representative points and deliberately generous radii).
 *
 * The upstream nationwide inventory can have wrong but numerically valid coordinates
 * in an individual province. Its min/max bounds then span much of the country
 * (e.g. a Seoul shard with a southern latitude of 33). Using those min/max
 * bounds to select shards silently loads the wrong provinces and leaves a
 * correctly centered map without markers. These are search hints, NOT legal
 * administrative boundaries or validation of individual charger locations.
 *
 * code -> [representative latitude, longitude, latitude radius, longitude radius]
 */
const REGION_SEARCH_AREAS = Object.freeze({
  '11': [37.5665, 126.9780, 0.30, 0.38], // 서울
  '12': [35.1595, 126.8526, 1.45, 2.15], // 전남·광주 통합
  '26': [35.1796, 129.0756, 0.55, 0.65], // 부산
  '27': [35.8714, 128.6014, 0.65, 0.75], // 대구
  '28': [37.4563, 126.7052, 0.85, 1.85], // 인천·도서
  '29': [35.1595, 126.8526, 0.48, 0.70], // 이전 광주 코드
  '30': [36.3504, 127.3845, 0.46, 0.56], // 대전
  '31': [35.5394, 129.3114, 0.47, 0.65], // 울산
  '36': [36.4801, 127.2890, 0.40, 0.46], // 세종
  '41': [37.2751, 127.0095, 1.18, 1.50], // 경기
  '42': [37.8813, 127.7298, 1.50, 1.72], // 이전 강원 코드
  '43': [36.6358, 127.4912, 1.06, 1.48], // 충북
  '44': [36.6588, 126.6728, 1.20, 1.40], // 충남
  '45': [35.8242, 127.1480, 1.10, 1.45], // 이전 전북 코드
  '46': [34.8161, 126.4630, 1.37, 1.68], // 이전 전남 코드
  '47': [36.5760, 128.5056, 1.55, 3.05], // 경북·울릉
  '48': [35.2383, 128.6924, 1.05, 1.65], // 경남
  '50': [33.4996, 126.5312, 0.65, 0.95], // 제주
  '51': [37.8813, 127.7298, 1.50, 1.72], // 강원
  '52': [35.8242, 127.1480, 1.10, 1.45], // 전북
});

function normalizeRegionSearchArea(region) {
  const area = REGION_SEARCH_AREAS[String(region.code)];
  if (!area) return region; // Future codes retain publisher-provided bounds.
  const [lat, lng, latRadius, lngRadius] = area;
  return {
    ...region,
    center: { lat, lng },
    bounds: {
      south: lat - latRadius, north: lat + latRadius,
      west: lng - lngRadius, east: lng + lngRadius,
    },
  };
}


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
    return { ...value, regions: value.regions.map(normalizeRegionSearchArea) };
  }

  async region(entry, { force = false, signal } = {}) {
    const code = String(entry.code);
    const cacheKey = `${code}:${entry.path}`;
    if (!force && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached;
    }
    const data = await this.request(entry.path, signal);
    if (!Array.isArray(data.stations) || String(data.regionCode) !== code) throw new Error('지역 충전소 정보를 확인할 수 없습니다.');
    const normalized = { ...data, regionCode: code, stations: data.stations.map(station => ({ ...station, id: String(station.id), regionCode: String(station.regionCode), chargers: (station.chargers || []).map(charger => ({ ...charger, id: String(charger.id), type: String(charger.type).padStart(2, '0'), status: String(charger.status ?? '0') })) })) };
    for (const key of this.cache.keys()) if (key.startsWith(`${code}:`) && key !== cacheKey) this.cache.delete(key);
    this.cache.set(cacheKey, normalized);
    // Limit memory when users pan across many provinces. Fetches can reuse the HTTP cache.
    while (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value);
    return normalized;
  }
}

export function selectViewportRegions(regions, bounds, limit = 4) {
  if (!bounds) return [];
  const center = { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
  // When no envelope intersects (e.g. an island or a new region code), show the
  // nearest available shards instead of leaving an otherwise valid map empty.
  const matching = regions.filter(region => intersects(bounds, region.bounds));
  const candidates = matching.length ? matching : regions;
  return [...candidates].sort((a, b) => {
    const score = region => Math.abs((region.bounds.south + region.bounds.north) / 2 - center.lat) + Math.abs((region.bounds.west + region.bounds.east) / 2 - center.lng);
    return score(a) - score(b);
  }).slice(0, limit);
}
