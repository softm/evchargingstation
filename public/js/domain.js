export const STATUS = Object.freeze({
  '0': '상태 알 수 없음', '1': '통신 이상', '2': '충전 대기', '3': '충전 중',
  '4': '운영 중지', '5': '점검 중', '6': '예약 중', '9': '상태 미확인',
});

export const TYPES = Object.freeze({
  '01': { name: 'DC차데모', connectors: ['chademo'] },
  '02': { name: 'AC완속', connectors: ['ac'] },
  '03': { name: 'DC차데모 + AC3상', connectors: ['chademo', 'ac3'] },
  '04': { name: 'DC콤보', connectors: ['combo'] },
  '05': { name: 'DC차데모 + DC콤보', connectors: ['chademo', 'combo'] },
  '06': { name: 'DC차데모 + AC3상 + DC콤보', connectors: ['chademo', 'ac3', 'combo'] },
  '07': { name: 'AC3상', connectors: ['ac3'] },
  '08': { name: 'DC콤보(완속)', connectors: ['combo'] },
  '09': { name: 'NACS', connectors: ['nacs'] },
  '10': { name: 'DC콤보 + NACS', connectors: ['combo', 'nacs'] },
  '11': { name: 'DC콤보2(버스 전용)', connectors: ['combo2'], busOnly: true },
});

export const DEFAULT_FILTERS = Object.freeze({ query: '', connector: '', minPower: 0, speed: '', operator: '', open24: false, available: false, unrestricted: false, freeParking: false, favorites: false, sort: 'available' });

export const SPEEDS = Object.freeze({ slow: '완속 · 30 kW 미만', medium: '중속 · 30–49 kW', fast50: '급속 · 50–99 kW', fast100: '급속 · 100–199 kW', ultra: '초급속 · 200 kW 이상' });

export function chargerSpeed(charger) {
  const power = charger.outputKw;
  if (typeof power !== 'number' || !Number.isFinite(power) || power <= 0) return '';
  return power < 30 ? 'slow' : power < 50 ? 'medium' : power < 100 ? 'fast50' : power < 200 ? 'fast100' : 'ultra';
}

export function operatorKey(station) {
  return station.operatorId ? `id:${station.operatorId}` : station.operatorName ? `name:${normalizedText(station.operatorName)}` : '';
}

export function isOpen24(station) {
  // Ambiguous exceptions and partial-day schedules must not become 24-hour access.
  const hours = normalizedText(station.useTime).replace(/\s/g, '');
  return /^(?:24시간(?:이용가능|운영|연중무휴)?|연중무휴24시간|00:00[~～–-](?:24:00|00:00))$/.test(hours);
}

export function typeInfo(type) {
  const code = String(type ?? '').padStart(2, '0');
  return TYPES[code] || { name: code && code !== '00' ? `기타 커넥터 (${code})` : '커넥터 미확인', connectors: [] };
}

function timestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

export function confirmation(charger, region, now = Date.now(), threshold = 600) {
  const candidates = [timestamp(charger.observedAt), region?.complete === false ? null : timestamp(region?.statusCoverageAt)].filter(value => value !== null);
  const valid = candidates.filter(value => value <= now + 60000);
  const confirmedAt = valid.length ? Math.max(...valid) : null;
  const fresh = confirmedAt !== null && now - confirmedAt <= Math.max(1, Number(threshold) || 600) * 1000;
  return { fresh, confirmedAt, futureTimestamp: candidates.some(value => value > now + 60000), reason: fresh ? 'fresh' : confirmedAt === null ? 'unknown' : 'stale' };
}

export function chargerState(charger, region, now = Date.now(), threshold = 600) {
  const check = confirmation(charger, region, now, threshold);
  const code = String(charger.status ?? '0');
  const sourceLabel = STATUS[code] || `미정의 상태 (${code})`;
  return { ...check, code, sourceLabel, available: check.fresh && code === '2', label: check.fresh ? sourceLabel : check.reason === 'stale' ? '확인 지연' : '현재 확인 필요' };
}

export function chargerMatches(charger, filters = DEFAULT_FILTERS, region, now = Date.now(), threshold = 600) {
  if (filters.connector && !typeInfo(charger.type).connectors.includes(filters.connector)) return false;
  if (filters.speed && chargerSpeed(charger) !== filters.speed) return false;
  const minimum = Number(filters.minPower) || 0;
  if (minimum > 0 && (charger.outputKw === null || charger.outputKw === undefined || !Number.isFinite(Number(charger.outputKw)) || Number(charger.outputKw) < minimum)) return false;
  if (filters.available && !chargerState(charger, region, now, threshold).available) return false;
  return true;
}

export function summarizeStation(station, region, filters = DEFAULT_FILTERS, now = Date.now(), threshold = 600) {
  const chargers = Array.isArray(station.chargers) ? station.chargers : [];
  const matches = chargers.filter(charger => chargerMatches(charger, { ...filters, available: false }, region, now, threshold));
  const states = matches.map(charger => chargerState(charger, region, now, threshold));
  const available = states.filter(item => item.available).length;
  const stale = states.filter(item => !item.fresh).length;
  const busy = states.filter(item => item.fresh && item.code === '3').length;
  const confirmed = states.filter(item => item.fresh).length;
  const unknown = states.filter(item => !item.fresh || !['2', '3', '4', '5', '6'].includes(item.code)).length;
  return { available, stale, unknown, busy, confirmed, matching: matches.length, total: chargers.length,
    tone: available > 0 ? 'available' : confirmed && !unknown ? 'busy' : 'unknown',
    label: available > 0 ? `${available}기 충전 대기` : !matches.length ? '조건 일치 없음' : unknown ? '현재 상태 확인 필요' : '충전 대기 없음',
    hasBusOnly: chargers.some(charger => typeInfo(charger.type).busOnly),
    maxPower: matches.reduce((max, charger) => Number.isFinite(charger.outputKw) ? Math.max(max, charger.outputKw) : max, 0) || null,
  };
}

export function normalizedText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ').trim();
}

export function filterStations(stations, regions, filters, favorites = new Set(), now = Date.now(), threshold = 600) {
  const query = normalizedText(filters.query);
  return stations.filter(station => {
    if (filters.favorites && !favorites.has(String(station.id))) return false;
    if (filters.operator && operatorKey(station) !== filters.operator) return false;
    if (filters.open24 && !isOpen24(station)) return false;
    if (filters.unrestricted && station.restricted !== false) return false;
    if (filters.freeParking && station.parkingFree !== true) return false;
    if (query && !normalizedText([station.name, station.address, station.detailAddress, station.operatorName].join(' ')).includes(query)) return false;
    const region = regions instanceof Map ? regions.get(String(station.regionCode)) : regions;
    return (station.chargers || []).some(charger => chargerMatches(charger, filters, region, now, threshold));
  });
}

export function hasCoordinates(station) {
  return typeof station.lat === 'number' && typeof station.lng === 'number' && Number.isFinite(station.lat) && Number.isFinite(station.lng) && station.lat >= -90 && station.lat <= 90 && station.lng >= -180 && station.lng <= 180 && !(station.lat === 0 && station.lng === 0);
}

export function distanceKm(from, to) {
  if (!hasCoordinates(from) || !hasCoordinates(to)) return Infinity;
  const radians = value => value * Math.PI / 180;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function intersects(a, b) {
  if (!a || !b) return false;
  return a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
}

export function safePhone(value) {
  const text = String(value || '').trim();
  return /^[+\d\s().-]+$/.test(text) && /\d{2}/.test(text) ? text.replace(/[^+\d]/g, '') : '';
}

export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function sourceUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && ['www.data.go.kr', 'data.go.kr', 'ev.or.kr', 'www.ev.or.kr'].includes(url.hostname) ? url.href : 'https://www.data.go.kr/data/15076352/openapi.do'; }
  catch { return 'https://www.data.go.kr/data/15076352/openapi.do'; }
}
