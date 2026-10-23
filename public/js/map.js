/** SOFTM-EV-MAP START 날짜:20261019 : 돌봄한눈의 선택 위치 보존과 배치 계산을 두 실제 지도 제공자에 공통 적용 */
import '../vendor/homecare/care-popup-geometry.js';
import '../vendor/homecare/map-marker-placement.js';

const INITIAL_CENTER = Object.freeze({ lat: 37.5665, lng: 126.978 });
export const DEFAULT_BROWSE_ZOOM = 15;
const LEAFLET = Object.freeze({
  script: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  style: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  scriptIntegrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  styleIntegrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
});
const resourceTasks = new Map();
const naverAuthObservers = new Set();
let authHookInstalled = false;

export function isCoordinate(point) {
  return point != null && typeof point.lat === 'number' && typeof point.lng === 'number'
    && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
    && !(point.lat === 0 && point.lng === 0);
}

export function parseSharedView(params) {
  const latitude = params.get('lat'), longitude = params.get('lng');
  if (!latitude?.trim() || !longitude?.trim()) return null;
  const center = { lat: Number(latitude), lng: Number(longitude) };
  if (!isCoordinate(center)) return null;
  const zoom = Number(params.get('z'));
  return { center, zoom: Number.isFinite(zoom) && zoom >= 6 && zoom <= 19 ? zoom : 14 };
}

export function normalizeBounds(bounds) {
  if (!bounds || !['south', 'north', 'west', 'east'].every(key => Number.isFinite(bounds[key]))) return null;
  if (bounds.south > bounds.north || bounds.west > bounds.east) return null;
  if (bounds.south > 90 || bounds.north < -90 || bounds.west > 180 || bounds.east < -180) return null;
  return { south: Math.max(-90, bounds.south), north: Math.min(90, bounds.north), west: Math.max(-180, bounds.west), east: Math.min(180, bounds.east) };
}

export function containsCoordinate(bounds, point) {
  const box = normalizeBounds(bounds);
  return Boolean(box && isCoordinate(point) && point.lat >= box.south && point.lat <= box.north && point.lng >= box.west && point.lng <= box.east);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

/** SOFTM-EV-VIEWPORT START 날짜:20261019 : 선택 이후 늦은 idle·크기 변경이 목록과 번호를 다시 바꾸지 않도록 실제 탐색 요청만 소비 */
export function createViewportGate() {
  let preserved = false;
  let pending = null;
  function consumeChange() {
    if (preserved || !pending) return null;
    const source = pending;
    pending = null;
    return source;
  }
  return {
    preserve() { preserved = true; pending = null; },
    userChange(source) { preserved = false; pending = source === 'programmatic' ? source : 'user'; },
    resize() { if (!preserved && !pending) pending = 'resize'; },
    consume() { return Boolean(consumeChange()); },
    consumeChange,
    isPreserved() { return preserved; }
  };
}
/** SOFTM-EV-VIEWPORT END */

export const markerScale = zoom => zoom < 14 ? 'dot' : zoom < 16 ? 'pin' : zoom < 18 ? 'name' : 'detail';
export const markerDetailLevel = zoom => zoom >= 18 ? 2 : zoom >= 16 ? 1 : 0;
export const labelBudget = (zoom, width = 800, height = 600) => {
  if (!(width > 0 && height > 0)) return 0;
  const cap = zoom < 12 ? 6 : zoom < 14 ? 12 : zoom < 16 ? 24 : 40;
  return Math.max(1, Math.min(cap, Math.floor(width * height / (zoom < 12 ? 50000 : zoom < 14 ? 35000 : zoom < 16 ? 24000 : 16000))));
};
export const compareMarkerLabels = (a, b, retained = new Map()) => Number(b.selected) - Number(a.selected)
  || Number(retained.has(b.id)) - Number(retained.has(a.id)) || a.id.localeCompare(b.id);
// SOFTM-EV-MARKER-SCALE 날짜:20261021 : 돌봄한눈처럼 이름을 먼저 확보하고 남는 공간에서 상태·출력 정보를 확장
export function planMarkerLabels(candidates, bounds, controls, pins, retained, budget) {
  const occupied = new Map(), placements = new Map();
  const ordered = [...candidates].sort((a, b) => compareMarkerLabels(a, b, retained));
  const obstacles = id => [...pins, ...controls, ...[...occupied].filter(([other]) => other !== id).map(([, rect]) => rect)];
  let remaining = budget;
  for (const item of ordered) {
    if (!item.selected && remaining <= 0) continue;
    let result = globalThis.CareMarkerPlacement.fit(item.rects.slice(0, 1), item.pin, bounds, obstacles(item.id), retained.get(item.id));
    if (!result && item.selected) result = globalThis.CareMarkerPlacement.fit(item.rects.slice(0, 1), item.pin, bounds, controls);
    if (!result) continue;
    placements.set(item.id, result);occupied.set(item.id, result.rect);
    if (!item.selected) remaining--;
  }
  for (const item of ordered) {
    const previous = placements.get(item.id);
    if (!previous) continue;
    const result = globalThis.CareMarkerPlacement.fit(item.rects, item.pin, bounds, obstacles(item.id), previous.side) || previous;
    placements.set(item.id, result);occupied.set(item.id, result.rect);
  }
  return placements;
}
const nonNegativeCount = value => Number.isInteger(value) && value >= 0 ? value : null;

export function buildMarkerModels(stations, { selectedId, summaries = new Map() } = {}) {
  const seen = new Set();
  return (Array.isArray(stations) ? stations : []).flatMap((station, index) => {
    if (!isCoordinate(station) || station.id == null || String(station.id) === '' || seen.has(String(station.id))) return [];
    const id = String(station.id);
    seen.add(id);
    const summary = typeof summaries?.get === 'function' ? summaries.get(station.id) ?? summaries.get(id) : summaries?.[id];
    const total = nonNegativeCount(summary?.total);
    const available = nonNegativeCount(summary?.available);
    const confirmed = total != null && available != null && available <= total;
    const tone = confirmed && ['available', 'charging', 'unavailable', 'unknown', 'restricted'].includes(summary?.tone) ? summary.tone : 'unknown';
    const label = String(summary?.label || '상태 미확인');
    const matching = nonNegativeCount(summary?.matching);
    const power = Number.isFinite(summary?.maxPower) && summary.maxPower > 0 ? summary.maxPower : null;
    const facts = [`전체 ${total !== null ? `${total}기` : '기수 미확인'}`];
    if (matching !== null && total !== null && matching < total) facts.push(`조건 일치 ${matching}기`);
    if (power !== null) facts.push(`조건 최대 ${power}kW`);
    const number = index + 1;
    return [{ id, station, number, rank: number <= 5 ? number : null, selected: String(selectedId ?? '') === id, tone,
      count: total !== null ? `${total}기` : '—', label, facts: facts.join(' · ') }];
  });
}

/** SOFTM-EV-MARKER-CULL START 날짜:20261019 : 전국 자료를 DOM 마커로 한 번에 만들지 않되 선택 위치와 원래 목록 순번을 보존 */
export function selectMarkerModels(stations, bounds, { selectedId, summaries = new Map(), limit = 600, padding = 0.12 } = {}) {
  const box = normalizeBounds(bounds);
  const cap = Math.max(1, Math.min(800, Math.floor(Number(limit) || 600)));
  const margin = Math.max(0, Math.min(1, Number(padding) || 0));
  const padded = box && normalizeBounds({ south: box.south - (box.north - box.south) * margin, north: box.north + (box.north - box.south) * margin,
    west: box.west - (box.east - box.west) * margin, east: box.east + (box.east - box.west) * margin });
  const within = (area, point) => area && point.lat >= area.south && point.lat <= area.north && point.lng >= area.west && point.lng <= area.east;
  const visible = [];
  const buffer = [];
  const seen = new Set();
  let selected = null;
  let visibleCount = 0;
  let candidateCount = 0;
  for (const [index, station] of (Array.isArray(stations) ? stations : []).entries()) {
    if (!isCoordinate(station) || station.id == null || String(station.id) === '' || seen.has(String(station.id))) continue;
    const id = String(station.id);
    seen.add(id);
    const record = { station, index, id };
    if (id === String(selectedId ?? '')) selected = record;
    if (within(box, station)) {
      visibleCount += 1;
      candidateCount += 1;
      if (visible.length < cap) visible.push(record);
    } else if (within(padded, station)) {
      candidateCount += 1;
      if (buffer.length < cap) buffer.push(record);
    }
  }
  const picked = [...visible];
  if (selected && !picked.some(record => record.id === selected.id)) {
    if (picked.length >= cap) picked.pop();
    picked.push(selected);
  }
  for (const record of buffer) {
    if (picked.length >= cap) break;
    if (record.id !== selected?.id) picked.push(record);
  }
  picked.sort((a, b) => a.index - b.index);
  const originalNumbers = new Map(picked.map(record => [record.id, record.index + 1]));
  const models = buildMarkerModels(picked.map(record => record.station), { selectedId, summaries }).map(model => {
    const number = originalNumbers.get(model.id);
    return { ...model, number, rank: number <= 5 ? number : null };
  });
  const omittedCount = Math.max(0, visibleCount - picked.filter(record => within(box, record.station)).length);
  return { models, visibleCount, candidateCount, omittedCount, limited: omittedCount > 0, limit: cap };
}
/** SOFTM-EV-MARKER-CULL END */

export function markerHtml(model) {
  const rank = Number.isInteger(model.rank) && model.rank >= 1 && model.rank <= 5 ? model.rank : null;
  const description = `${rank ? `${rank}위. ` : ''}${model.station.name || '이름 미제공 충전소'}. ${model.label}. 총 ${model.count}`;
  const rankClass = rank ? ` is-ranked ev-map-pin--rank-${rank}` : '';
  const rankBadge = rank ? `<span class="ev-map-pin-rank" aria-hidden="true">${rank}위</span>` : '';
  return `<div class="ev-map-marker${rank ? ' ev-map-marker--ranked' : ''}"><button type="button" class="ev-map-pin ev-map-pin--${model.tone}${rankClass}${model.selected ? ' is-selected' : ''}" data-station-id="${escapeHtml(model.id)}" aria-label="${escapeHtml(description)}" aria-pressed="${model.selected}" title="${escapeHtml(description)}">${rankBadge}<span class="ev-map-pin-symbol" aria-hidden="true">⚡</span><span class="ev-map-pin-count" aria-hidden="true">${escapeHtml(model.count)}</span><span class="ev-map-pin-label" data-label-level="0" aria-hidden="true" hidden><span class="ev-map-label-title">${escapeHtml(model.station.name || '이름 미제공 충전소')}</span><span class="ev-map-label-context">${escapeHtml(model.label)}</span><span class="ev-map-label-detail">${escapeHtml(model.facts || '')}</span></span></button></div>`;
}

function mapError(code, message, recoverable = true) {
  return Object.assign(new Error(message), { code, recoverable });
}

function loadResource(url, type, integrity = '') {
  const href = new URL(url, document.baseURI).href;
  const key = `${type}:${href}`;
  if (resourceTasks.has(key)) return resourceTasks.get(key);
  const task = new Promise((resolve, reject) => {
    const element = document.createElement(type === 'style' ? 'link' : 'script');
    if (type === 'style') { element.rel = 'stylesheet'; element.href = href; }
    else { element.src = href; element.async = true; }
    if (integrity) { element.integrity = integrity; element.crossOrigin = 'anonymous'; }
    const timer = setTimeout(() => finish(mapError('MAP_RESOURCE_TIMEOUT', '지도 리소스 연결이 지연되고 있습니다.')), 12000);
    function finish(error) {
      clearTimeout(timer);
      element.onload = element.onerror = null;
      if (error) { element.remove(); reject(error); }
      else resolve();
    }
    element.onload = () => finish();
    element.onerror = () => finish(mapError('MAP_RESOURCE_LOAD', '지도 리소스를 불러오지 못했습니다.'));
    document.head.append(element);
  }).catch(error => { resourceTasks.delete(key); throw error; });
  resourceTasks.set(key, task);
  return task;
}

function observeNaverAuth(callback) {
  if (!authHookInstalled) {
    const previous = globalThis.navermap_authFailure;
    globalThis.navermap_authFailure = (...args) => {
      try { previous?.(...args); } catch { /* 기존 콜백 실패가 대체 지도 전환을 막지 않음. */ }
      for (const observer of naverAuthObservers) observer(mapError('NAVER_AUTH', '네이버 지도 인증을 확인하지 못해 기본 지도로 전환합니다.'));
    };
    authHookInstalled = true;
  }
  naverAuthObservers.add(callback);
  return () => naverAuthObservers.delete(callback);
}

async function loadNaver(clientId) {
  if (globalThis.naver?.maps?.Map) return globalThis.naver.maps;
  let stop;
  try {
    await Promise.race([
      loadResource(`https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}&submodules=geocoder`, 'script'),
      new Promise((_, reject) => { stop = observeNaverAuth(reject); })
    ]);
    if (!globalThis.naver?.maps?.Map) throw mapError('NAVER_SDK', '네이버 지도를 시작하지 못해 기본 지도로 전환합니다.');
    return globalThis.naver.maps;
  } finally { stop?.(); }
}

async function loadLeaflet(config) {
  const custom = config.leafletAssets || {};
  await Promise.all([
    loadResource(custom.style || LEAFLET.style, 'style', custom.style ? custom.styleIntegrity || '' : LEAFLET.styleIntegrity),
    globalThis.L?.map ? Promise.resolve() : loadResource(custom.script || LEAFLET.script, 'script', custom.script ? custom.scriptIntegrity || '' : LEAFLET.scriptIntegrity)
  ]);
  if (!globalThis.L?.map) throw mapError('LEAFLET_SDK', '기본 지도를 시작하지 못했습니다. 충전소 목록을 이용해 주세요.', false);
  return globalThis.L;
}

function installStyles() {
  if (document.getElementById('ev-map-adapter-styles')) return;
  const style = document.createElement('style');
  style.id = 'ev-map-adapter-styles';
  style.textContent = `
    .ev-map-host{position:relative;isolation:isolate;overflow:hidden;background:#e8eee9;min-height:180px}
    .ev-map-canvas{position:absolute;inset:0;width:100%;height:100%;z-index:0;background:#e8eee9}
    .ev-map-provider-note{position:absolute;left:12px;top:var(--ev-map-controls-top,84px);z-index:800;max-width:calc(100% - 82px);margin:0;padding:6px 9px;border:1px solid #d9e2df;border-radius:8px;background:#fffffff0;color:#40524b;font:500 11px/1.5 system-ui,sans-serif;white-space:pre-line;box-shadow:0 2px 8px #18342a0a;pointer-events:none}
    .ev-map-tools{position:absolute;top:var(--ev-map-controls-top,84px);right:12px;z-index:800;display:grid;gap:1px;overflow:hidden;border:1px solid #d5dfdb;border-radius:12px;box-shadow:0 3px 14px #18342a16}
    .ev-map-tools button{display:grid;place-items:center;width:44px;height:44px;margin:0;padding:0;border:0;background:white;color:#193c30;font:500 24px/1 system-ui;cursor:pointer}
    .ev-map-tools button:hover{background:#f1f7f4}.ev-map-tools button:focus-visible,.ev-map-pin:focus-visible{outline:3px solid #1590df;outline-offset:3px}
    .ev-leaflet-icon{background:transparent;border:0}.ev-map-marker{position:relative;width:64px;height:44px;pointer-events:none}
    .ev-map-pin{position:absolute;left:50%;bottom:6px;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;gap:4px;min-width:48px;height:32px;padding:4px 7px;overflow:visible;border:2px solid white;border-radius:16px;background:#718078;color:white;box-shadow:0 2px 5px #123a2840;cursor:pointer;font:700 12px/1.2 system-ui,sans-serif;white-space:nowrap;pointer-events:auto}
    .ev-map-pin:after{content:"";position:absolute;bottom:-6px;left:calc(50% - 5px);width:8px;height:8px;background:inherit;border-right:2px solid white;border-bottom:2px solid white;transform:rotate(45deg)}
    .ev-map-pin--available{background:#13a67c}.ev-map-pin--charging{background:#5982fc}.ev-map-pin--unavailable{background:#f15c5c}.ev-map-pin--unknown{background:#f4a22a}.ev-map-pin--restricted{background:#757e90}
    .ev-map-pin-symbol{display:none;font-size:13px;line-height:1}
    .ev-map-pin-count{font-size:12px;letter-spacing:-.2px}.ev-map-pin.is-selected{outline:3px solid #164937;outline-offset:2px;box-shadow:0 0 0 7px #ffffffc9,0 5px 16px #163f3040}
    .ev-map-pin.is-ranked{bottom:8px;min-width:58px;height:38px;padding:4px 9px 4px 7px;border-width:3px;border-radius:20px;background:#ff9418;box-shadow:0 0 0 3px #ffc04a66,0 6px 14px #a957243d;animation:ev-rank-bounce 1.45s cubic-bezier(.34,1.56,.64,1) infinite;transform-origin:50% 100%}
    .ev-map-pin.is-ranked::before{content:"";position:absolute;inset:-8px;border:2px solid #ffb32870;border-radius:24px;opacity:.45;pointer-events:none}
    .ev-map-pin.is-ranked .ev-map-pin-symbol{display:none}.ev-map-pin.is-ranked .ev-map-pin-count{font-size:10px;font-weight:800;opacity:.92}
    .ev-map-pin-rank{font-size:15px;font-weight:900;letter-spacing:-.5px}.ev-map-pin--rank-1{min-width:66px;height:44px;background:#f08a00;animation-delay:0s}.ev-map-pin--rank-1 .ev-map-pin-rank{font-size:18px}
    .ev-map-pin--rank-2{animation-delay:.11s}.ev-map-pin--rank-3{animation-delay:.22s}.ev-map-pin--rank-4{animation-delay:.33s}.ev-map-pin--rank-5{animation-delay:.44s}
    @keyframes ev-rank-bounce{0%,100%{transform:translateX(-50%) translateY(0) scale(1)}18%{transform:translateX(-50%) translateY(-9px) scale(1.08,.94)}34%{transform:translateX(-50%) translateY(0) scale(.97,1.04)}50%{transform:translateX(-50%) translateY(-4px) scale(1.03,.98)}66%{transform:translateX(-50%) translateY(0) scale(1)}}
    .ev-map-pin-label{position:absolute;left:50%;bottom:calc(100% + 10px);transform:translateX(-50%);width:max-content;max-width:220px;padding:5px 8px;overflow:hidden;text-overflow:ellipsis;border:1px solid #dce7e1;border-radius:8px;background:#fffffff5;color:#1b3b2c;font:600 12px/1.35 system-ui,sans-serif;box-shadow:0 2px 8px #153e2814;pointer-events:auto;cursor:pointer;text-align:left}
    .ev-map-label-title{display:block;overflow:hidden;text-overflow:ellipsis}.ev-map-label-context,.ev-map-label-detail{display:none;white-space:normal;font-size:11px;line-height:1.5;font-weight:500}
    .ev-map-pin-label[data-label-level="1"] .ev-map-label-context,.ev-map-pin-label[data-label-level="2"] .ev-map-label-context{display:block;margin-top:4px;color:#346255}
    .ev-map-pin-label[data-label-level="2"] .ev-map-label-detail{display:block;margin-top:4px;padding-top:4px;border-top:1px solid #e3eae8;color:#53655f}
    .ev-map-pin-label:not([data-label-level="0"]){max-width:220px;padding:7px 9px}
    .ev-map-host[data-marker-scale="dot"] .ev-map-pin:not(.is-selected):not(.is-ranked){bottom:0;transform:translate(-50%,50%);width:12px;min-width:12px;height:12px;min-height:12px;padding:0;gap:0;border-radius:50%;box-shadow:none}
    .ev-map-host[data-marker-scale="dot"] .ev-map-pin:not(.is-selected):not(.is-ranked)::after{display:none}
    .ev-map-host[data-marker-scale="dot"] .ev-map-pin:not(.is-selected):not(.is-ranked) .ev-map-pin-count{display:none}
    .ev-map-host[data-marker-scale="pin"] .ev-map-pin:not(.is-selected):not(.is-ranked){width:26px;min-width:26px;height:26px;padding:0;border-radius:50%}
    .ev-map-host[data-marker-scale="pin"] .ev-map-pin:not(.is-selected):not(.is-ranked) .ev-map-pin-symbol{display:block}
    .ev-map-host[data-marker-scale="pin"] .ev-map-pin:not(.is-selected):not(.is-ranked) .ev-map-pin-count{display:none}
    .ev-map-host[data-marker-scale="name"] .ev-map-pin:not(.is-selected):not(.is-ranked){min-width:38px;height:30px}
    .ev-map-host[data-marker-scale="dot"] .ev-map-pin-label{max-width:116px;font-size:11px;padding:3px 5px}
    .ev-map-host[data-marker-scale="pin"] .ev-map-pin-label{max-width:140px}
    .ev-map-host.ev-map-dense .ev-map-pin:not(.is-selected):not(.is-ranked){box-shadow:none}
    .ev-map-pin.is-selected .ev-map-pin-label{max-width:240px;font-size:14px;font-weight:800;border:2px solid #087f64;background:#effcf6;color:#075842;padding:8px 11px}
    .ev-map-pin-label[hidden]{display:none}.ev-map-current{width:18px;height:18px;border:3px solid white;border-radius:50%;background:#287de0;box-shadow:0 0 0 7px #287de025,0 2px 5px #14366244}
    .ev-map-failure{position:absolute;inset:0;display:grid;place-content:center;gap:10px;padding:24px;text-align:center;color:#324c40;font:500 14px/1.6 system-ui;background:#f2f6f3}
    .ev-map-host .leaflet-control-attribution{max-width:100%;font-size:10px}.ev-map-host .leaflet-control-scale-line{font-size:10px}
    @media(max-width:760px){.ev-map-host{--ev-map-controls-top:64px}.ev-map-pin-label:not([data-label-level="0"]){max-width:200px}}
    @media(prefers-reduced-motion:reduce){.ev-map-host *{scroll-behavior:auto!important}.ev-map-pin.is-ranked{animation:none!important}}
  `;
  document.head.append(style);
}

function leafletEngine(L, canvas, { userChange, settled, select, background, tileFailure, tileSuccess }) {
  const map = L.map(canvas, { center: [INITIAL_CENTER.lat, INITIAL_CENTER.lng], zoom: 12, minZoom: 6, maxZoom: 19,
    zoomControl: false, attributionControl: true, scrollWheelZoom: true, touchZoom: true, keyboard: true,
    maxBounds: [[31.5, 122], [41, 135]], maxBoundsViscosity: 0.8 });
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' }).addTo(map);
  tiles.on('tileerror', tileFailure).on('tileload', tileSuccess);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
  map.on('dragstart', userChange).on('dragend moveend zoomend', settled).on('click', background);
  const icon = model => L.divIcon({ html: markerHtml(model), className: 'ev-leaflet-icon', iconSize: [64, 44], iconAnchor: [32, 44] });
  return {
    provider: 'leaflet',
    supportsMapType() { return false; },
    getMapType() { return 'normal'; },
    toggleMapType() { return false; },
    getBounds() { const box = map.getBounds(); return normalizeBounds({ south: box.getSouth(), north: box.getNorth(), west: box.getWest(), east: box.getEast() }); },
    getCenter() { const point = map.getCenter(); return { lat: point.lat, lng: point.lng }; },
    getZoom() { return map.getZoom(); },
    setView(point, zoom) { map.stop(); map.setView([point.lat, point.lng], zoom, { animate: false }); },
    add(model) { const marker = L.marker([model.station.lat, model.station.lng], { icon: icon(model), keyboard: false, bubblingMouseEvents: false, zIndexOffset: model.selected ? 5000 : model.rank ? 4500 - model.rank : 0 }).addTo(map); marker.on('click', event => { event.originalEvent?.stopPropagation?.(); select(model.id); }); return marker; },
    update(marker, model) { marker.setLatLng([model.station.lat, model.station.lng]); marker.setIcon(icon(model)); marker.setZIndexOffset(model.selected ? 5000 : model.rank ? 4500 - model.rank : 0); },
    remove(marker) { marker.remove(); },
    addLocation(point) { return L.marker([point.lat, point.lng], { icon: L.divIcon({ html: '<div class="ev-map-current"></div>', className: 'ev-leaflet-icon', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, keyboard: false, zIndexOffset: 6000 }).addTo(map); },
    resize() { map.invalidateSize({ animate: false, pan: false, debounceMoveend: true }); },
    destroy() { map.remove(); }
  };
}

function naverEngine(N, canvas, { userChange, settled, select, background }) {
  const map = new N.Map(canvas, { center: new N.LatLng(INITIAL_CENTER.lat, INITIAL_CENTER.lng), zoom: 12, minZoom: 6, maxZoom: 19,
    zoomControl: false, mapTypeControl: false, scaleControl: true, logoControl: true, mapDataControl: true,
    scrollWheel: true, pinchZoom: true, draggable: true, keyboardShortcuts: true });
  const listeners = [];
  const ownedMarkers = new Set();
  const bind = (target, event, callback) => { const listener = N.Event.addListener(target, event, callback); listeners.push(listener); return listener; };
  bind(map, 'dragstart', userChange);
  for (const event of ['dragend', 'idle', 'zoom_changed']) bind(map, event, settled);
  bind(map, 'click', background);
  const icon = model => ({ content: markerHtml(model), size: new N.Size(64, 44), anchor: new N.Point(32, 44) });
  return {
    provider: 'naver',
    supportsMapType() { return Boolean(N.MapTypeId?.NORMAL && (N.MapTypeId?.HYBRID || N.MapTypeId?.SATELLITE)); },
    getMapType() {
      const current = map.getMapTypeId?.();
      return current === N.MapTypeId?.HYBRID || current === N.MapTypeId?.SATELLITE ? 'satellite' : 'normal';
    },
    toggleMapType() {
      const normal = N.MapTypeId?.NORMAL;
      const satellite = N.MapTypeId?.HYBRID || N.MapTypeId?.SATELLITE;
      if (!normal || !satellite || !map.setMapTypeId) return false;
      const next = map.getMapTypeId?.() === normal ? satellite : normal;
      map.setMapTypeId(next);
      return next === normal ? 'normal' : 'satellite';
    },
    getBounds() { const box = map.getBounds(); const sw = box.getSW(); const ne = box.getNE(); return normalizeBounds({ south: sw.lat(), north: ne.lat(), west: sw.lng(), east: ne.lng() }); },
    getCenter() { const point = map.getCenter(); return { lat: point.lat(), lng: point.lng() }; },
    getZoom() { return map.getZoom(); },
    setView(point, zoom) { map.stop(); map.updateBy(new N.LatLng(point.lat, point.lng), zoom); },
    add(model) { const marker = new N.Marker({ map, position: new N.LatLng(model.station.lat, model.station.lng), title: `${model.number}. ${model.station.name}`, icon: icon(model), zIndex: model.selected ? 5000 : model.rank ? 4500 - model.rank : model.number }); N.Event.addListener(marker, 'click', () => select(model.id)); ownedMarkers.add(marker); return marker; },
    update(marker, model) { marker.setPosition(new N.LatLng(model.station.lat, model.station.lng)); marker.setIcon(icon(model)); marker.setZIndex(model.selected ? 5000 : model.rank ? 4500 - model.rank : model.number); },
    remove(marker) { N.Event.clearInstanceListeners(marker); marker.setMap(null); ownedMarkers.delete(marker); },
    addLocation(point) { const marker = new N.Marker({ map, position: new N.LatLng(point.lat, point.lng), title: '내 위치', clickable: false, zIndex: 6000, icon: { content: '<div class="ev-map-current"></div>', size: new N.Size(18, 18), anchor: new N.Point(9, 9) } }); ownedMarkers.add(marker); return marker; },
    resize() { map.autoResize(); },
    destroy() { for (const marker of ownedMarkers) { N.Event.clearInstanceListeners(marker); marker.setMap(null); } ownedMarkers.clear(); for (const listener of listeners) N.Event.removeListener(listener); map.destroy(); }
  };
}

export async function createMap({ container, config = {}, onSelect = () => {}, onBoundsChange = () => {}, onBackgroundClick = () => {}, onError = () => {} }) {
  const host = typeof container === 'string' ? document.getElementById(container) : container;
  if (!host?.append) throw mapError('MAP_CONTAINER', '지도를 표시할 영역이 없습니다.', false);
  installStyles();
  host.classList.add('ev-map-host');
  const canvas = document.createElement('div');
  canvas.className = 'ev-map-canvas';
  canvas.setAttribute('aria-label', '전기차 충전소 지도');
  const note = document.createElement('p');
  note.className = 'ev-map-provider-note';
  note.setAttribute('role', 'status');
  note.dataset.mapObstacle = '';
  note.textContent = '지도를 불러오는 중';
  const controls = document.createElement('div');
  controls.className = 'ev-map-tools';
  controls.dataset.mapObstacle = '';
  controls.innerHTML = '<button type="button" data-map-zoom="1" aria-label="지도 확대" title="지도 확대">+</button><button type="button" data-map-zoom="-1" aria-label="지도 축소" title="지도 축소">−</button>';
  host.append(canvas, note, controls);
  let engine = null;
  let destroyed = false;
  let switching = false;
  let fallbackReason = '';
  let rows = [];
  let selection = null;
  let summaries = new Map();
  let requestedView = { point: INITIAL_CENTER, zoom: DEFAULT_BROWSE_ZOOM };
  let locationPoint = null;
  let locationMarker = null;
  let boundsTimer = 0;
  let drawTimer = 0;
  let densityMessage = '';
  let labelFrame = 0;
  let focusFrame = 0;
  let selectedAt = 0;
  let tileErrors = 0;
  const markers = new Map();
  const labelSides = new Map();
  const gate = createViewportGate();
  const cleanups = [];
  const report = error => { if (!destroyed) onError(error); };

  function providerNote() {
    const provider = engine?.provider === 'naver' ? 'NAVER 지도' : fallbackReason ? 'OpenStreetMap 지도 · 기본 지도로 전환됨' : 'OpenStreetMap 지도';
    return densityMessage ? `${provider}\n${densityMessage}` : provider;
  }

  function obstacles() {
    return [...document.querySelectorAll('[data-map-obstacle]'), ...canvas.querySelectorAll('.leaflet-control')]
      .filter(element => !element.hidden && getComputedStyle(element).display !== 'none')
      .map(element => element.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
  }

  function layoutLabels() {
    labelFrame = 0;
    if (destroyed || !engine) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const zoom = engine.getZoom(), limit = labelBudget(zoom, bounds.width, bounds.height);
    const intersects = rect => rect.width > 0 && rect.height > 0 && rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom;
    const entries = [...canvas.querySelectorAll('.ev-map-pin')].map(pin => ({pin, label:pin.querySelector('.ev-map-pin-label'), id:pin.dataset.stationId, selected:pin.classList.contains('is-selected')}));
    // Hide first, then measure in batches. Avoid one forced layout per marker.
    for (const item of entries) if (item.label) {item.label.hidden = true;item.label.style.visibility = 'hidden';item.label.style.transform = 'translateX(-50%)';}
    for (const item of entries) item.pinRect = item.pin.getBoundingClientRect();
    const candidates = entries.filter(item => item.label && intersects(item.pinRect))
      .sort((a, b) => compareMarkerLabels(a, b, labelSides)).slice(0, Math.max(24, limit * 4));
    const controls = obstacles().filter(intersects), pins = entries.map(item => item.pinRect).filter(intersects);
    for (const item of candidates) {item.rects = [];item.label.hidden = false;}
    for (let level = 0; level <= markerDetailLevel(zoom); level++) {
      for (const item of candidates) item.label.dataset.labelLevel = String(level);
      for (const item of candidates) item.rects.push(item.label.getBoundingClientRect());
    }
    const placements = planMarkerLabels(candidates.map(item => ({...item,pin:item.pinRect})), bounds, controls, pins, labelSides, limit);
    for (const item of candidates) {
      const result = placements.get(item.id);item.label.hidden = !result;
      if (!result) continue;
      item.label.dataset.labelLevel = String(result.level);
      item.label.style.transform = `translateX(-50%) translate(${result.dx}px, ${result.dy}px)`;
      item.label.style.visibility = '';
      labelSides.set(item.id, result.side);
    }
    for (const id of labelSides.keys()) if (!placements.has(id)) labelSides.delete(id);
  }

  function queueLabels() {
    if (!labelFrame && !destroyed) labelFrame = requestAnimationFrame(layoutLabels);
  }

  function settled() {
    if (destroyed) return;
    if (engine) host.dataset.markerScale = markerScale(engine.getZoom());
    queueLabels();
    clearTimeout(drawTimer);
    drawTimer = setTimeout(draw, 80);
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!engine || destroyed || !canvas.clientWidth || !canvas.clientHeight) return;
      const bounds = engine.getBounds();
      if (bounds) {
        const source = gate.consumeChange();
        if (source) onBoundsChange(bounds, { source });
      }
    }, 350);
  }

  function userChange(source) {
    if (destroyed) return;
    cancelAnimationFrame(focusFrame);
    gate.userChange(source);
    clearTimeout(boundsTimer);
    clearTimeout(drawTimer);
  }

  function select(id) {
    if (destroyed) return;
    selectedAt = Date.now();
    onSelect(id);
  }

  function draw() {
    if (!engine || destroyed) return;
    host.dataset.markerScale = markerScale(engine.getZoom());
    const zoom = engine.getZoom();
    const view = selectMarkerModels(rows, engine.getBounds(), { selectedId: selection, summaries, limit: zoom < 11 ? 160 : zoom < 14 ? 380 : 800 });
    const models = view.models;
    host.classList.toggle('ev-map-dense', view.visibleCount > 500);
    densityMessage = view.limited ? `지도 ${models.length.toLocaleString()}곳 표시 · 확대하면 더 자세히 볼 수 있습니다` : '';
    if (tileErrors < 3) note.textContent = providerNote();
    const wanted = new Set(models.map(model => model.id));
    for (const [id, record] of markers) if (!wanted.has(id)) { engine.remove(record.marker); markers.delete(id); labelSides.delete(id); }
    for (const model of models) {
      const signature = `${model.station.lat}|${model.station.lng}|${markerHtml(model)}`;
      const record = markers.get(model.id);
      if (record) { if (record.signature !== signature) { engine.update(record.marker, model); record.signature = signature; } }
      else markers.set(model.id, { marker: engine.add(model), signature });
    }
    queueLabels();
  }

  const events = {
    userChange, settled, select,
    background(event) { const target = event?.originalEvent?.target || event?.pointerEvent?.target || event?.domEvent?.target; if (Date.now() - selectedAt < 350 || target?.closest?.('.ev-map-pin')) return; onBackgroundClick(); },
    tileFailure() { tileErrors += 1; if (tileErrors === 3) { note.textContent = '지도 배경 연결 지연 · 충전소 목록은 계속 이용할 수 있습니다'; report(mapError('MAP_TILES', '지도 배경 일부를 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.')); } },
    tileSuccess() { tileErrors = 0; note.textContent = providerNote(); }
  };

  function activate(next) {
    engine = next;
    host.dataset.mapProvider = engine.provider;
    note.textContent = providerNote();
    note.title = fallbackReason || (engine.provider === 'naver' ? '네이버 지도' : 'OpenStreetMap 지도 데이터');
    engine.setView(requestedView.point, requestedView.zoom);
    draw();
    if (locationPoint) locationMarker = engine.addLocation(locationPoint);
  }

  async function switchToLeaflet(reason) {
    if (switching || destroyed || engine?.provider === 'leaflet') return;
    switching = true;
    fallbackReason = reason?.message || '';
    if (reason) report(reason);
    if (engine) {
      requestedView = { point: engine.getCenter(), zoom: engine.getZoom() };
      engine.destroy();
      engine = null;
      markers.clear();
      locationMarker = null;
      canvas.replaceChildren();
    }
    try {
      const L = await loadLeaflet(config);
      if (!destroyed) activate(leafletEngine(L, canvas, events));
    } finally { switching = false; }
  }

  function failure(error) {
    note.hidden = true;
    controls.hidden = true;
    canvas.replaceChildren();
    const message = document.createElement('div');
    message.className = 'ev-map-failure';
    message.setAttribute('role', 'status');
    message.textContent = '지도를 불러오지 못했습니다. 충전소 목록을 이용하거나 네트워크 연결 후 새로고침해 주세요.';
    canvas.append(message);
    report(error);
  }

  try {
    const id = String(config.naverMapClientId || '').trim();
    if (id) {
      try { activate(naverEngine(await loadNaver(id), canvas, events)); }
      catch (error) { await switchToLeaflet(error); }
    } else await switchToLeaflet();
  } catch (error) { failure(error); throw error; }

  const stopAuth = observeNaverAuth(error => { if (engine?.provider === 'naver') void switchToLeaflet(error).catch(failure); });
  cleanups.push(stopAuth);
  function listen(target, name, handler, options) {
    target.addEventListener(name, handler, options);
    cleanups.push(() => target.removeEventListener(name, handler, options));
  }
  listen(host, 'click', event => {
    const label = event.target.closest?.('.ev-map-pin-label');
    if (!label) return;
    const pin = label.closest('.ev-map-pin[data-station-id]');
    if (!pin) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(pin.dataset.stationId);
  }, true);
  listen(canvas, 'wheel', userChange, { capture: true, passive: true });
  listen(canvas, 'touchstart', event => { if (event.touches.length > 1) userChange(); }, { capture: true, passive: true });
  listen(canvas, 'dblclick', event => { if (!event.target.closest('.ev-map-pin')) userChange(); }, true);
  listen(canvas, 'keydown', event => {
    if (event.target.closest('.ev-map-pin')) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', '='].includes(event.key)) userChange();
  }, true);
  listen(controls, 'click', event => {
    const button = event.target.closest('[data-map-zoom]');
    if (!button || !engine) return;
    event.stopPropagation();
    userChange();
    engine.setView(engine.getCenter(), Math.max(6, Math.min(19, engine.getZoom() + Number(button.dataset.mapZoom))));
    settled();
  });

  const api = {
    setStations(stations, options = {}) { rows = Array.isArray(stations) ? stations : []; selection = options.selectedId ?? null; summaries = options.summaries || new Map(); draw(); },
    focus(station, { zoom = 15 } = {}) {
      if (!isCoordinate(station) || destroyed) return false;
      clearTimeout(boundsTimer);
      cancelAnimationFrame(focusFrame);
      gate.preserve();
      selection = station.id;
      requestedView = { point: { lat: station.lat, lng: station.lng }, zoom: Math.max(6, Math.min(19, Number.isFinite(zoom) ? zoom : 15)) };
      engine?.setView(requestedView.point, requestedView.zoom);
      draw();
      focusFrame = requestAnimationFrame(() => {
        if (!engine || destroyed || !gate.isPreserved()) return;
        const mapRect = canvas.getBoundingClientRect();
        const covering = obstacles().filter(rect => rect.left < mapRect.right && rect.right > mapRect.left && rect.top < mapRect.bottom && rect.bottom > mapRect.top).sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const point = globalThis.CarePopupGeometry.focusCenter(requestedView.point, engine.getBounds(), mapRect, covering, { top: 64, right: 64, bottom: 36, left: 28, gap: 20 });
        if (isCoordinate(point)) engine.setView(point, requestedView.zoom);
        queueLabels();
      });
      return true;
    },
    getBounds() { return engine?.getBounds() || null; },
    getCenter() { return engine?.getCenter() || { ...requestedView.point }; },
    getZoom() { return engine?.getZoom() ?? requestedView.zoom; }, // SOFTM-EV-SHARE-ZOOM 날짜:20261019 : 공유 링크가 현재 지도 배율을 그대로 복원하도록 공개 인터페이스에 전달
    getProvider() { return engine?.provider || null; },
    supportsMapType() { return Boolean(engine?.supportsMapType?.()); },
    getMapType() { return engine?.getMapType?.() || 'normal'; },
    toggleMapType() {
      const type = engine?.toggleMapType?.();
      if (type) { queueLabels(); settled(); }
      return type || false;
    },
    setCenter(point, zoom) {
      if (!isCoordinate(point) || destroyed) return false;
      userChange('programmatic');
      requestedView = { point: { lat: point.lat, lng: point.lng }, zoom: Math.max(6, Math.min(19, Number.isFinite(zoom) ? zoom : engine?.getZoom() || 14)) };
      engine?.setView(requestedView.point, requestedView.zoom);
      settled();
      return true;
    },
    locate(point) {
      if (!isCoordinate(point) || destroyed) return false;
      locationPoint = { lat: point.lat, lng: point.lng };
      if (locationMarker && engine) engine.remove(locationMarker);
      locationMarker = engine?.addLocation(locationPoint) || null;
      return api.setCenter(locationPoint, DEFAULT_BROWSE_ZOOM);
    },
    resize() {
      if (destroyed || !engine || !canvas.clientWidth || !canvas.clientHeight) return;
      gate.resize();
      engine.resize();
      settled();
    },
    destroy() {
      destroyed = true;
      clearTimeout(boundsTimer);
      clearTimeout(drawTimer);
      cancelAnimationFrame(labelFrame);
      cancelAnimationFrame(focusFrame);
      for (const cleanup of cleanups) cleanup();
      engine?.destroy();
      engine = null;
      markers.clear();
      canvas.remove(); note.remove(); controls.remove();
      delete host.dataset.mapProvider;
      delete host.dataset.markerScale;
      host.classList.remove('ev-map-host', 'ev-map-dense');
    }
  };
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => api.resize());
    observer.observe(host);
    cleanups.push(() => observer.disconnect());
  }
  return api;
}
/** SOFTM-EV-MAP END */
