import { createMap, parseSharedView } from './map.js';
import { revealSelectedCard, bindListScrollSelection } from './selection.js';
import { createAdManager } from './ads.js';
import { mountListAds } from './ad-list.js';
import { mountBottomAd } from './ad-bottom.js';
import { mountWelcome } from './ad-welcome.js';
import { DataClient, selectViewportRegions } from './data.js';
import { LiveStatusClient } from './live-status.js';
import { DEFAULT_FILTERS, SPEEDS, chargerState, chargerSpeed, operatorKey, isOpen24, summarizeStation, filterStations, typeInfo, distanceKm, hasCoordinates, insideMapBounds, safePhone, sourceUrl } from './domain.js';
import { compareStations, nearbyAlternatives, estimateChargingCost } from './discovery.js';
import { facilityName, facilityDetailName } from './fees.js';
import { stationFloors, statusSummaryHTML, chargerRowsHTML, chargingHelpHTML, tariffGuideHTML } from './station-details.js';
import { createMobileMapFocus } from './mobile-map-focus.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const params = new URLSearchParams(location.search);
const sharedView = parseSharedView(params);
const config = window.EV_CONFIG || {};
const client = new DataClient(config);
const demo = params.get('demo') === '1';
const liveStatus = new LiveStatusClient(demo ? {} : config);
const adManager = createAdManager({ config: window.EV_AD_CONFIG,
  preview: params.get('ad-preview') === '1', demo, win: window, doc: document, location });
const listAds = mountListAds({root:$('listContent'),manager:adManager});
const bottomAd = mountBottomAd({host:$('bottomAd'),manager:adManager,onSpaceChange:()=>requestAnimationFrame(()=>map?.resize())});
const welcomeAd = mountWelcome({dialog:$('welcomeAdDialog'),manager:adManager,onChange:syncAds});
function syncAds() {
  adManager.setBlocked($('welcomeAdDialog').open || $('filterDialog').open || $('stationDialog').open);
  bottomAd.setContext({isList:!window.matchMedia('(max-width:760px)').matches || !$('appLayout').classList.contains('mobile-map'),detailOpen:$('stationDialog').open || $('filterDialog').open || $('welcomeAdDialog').open});
  listAds.sync();
}
const favoriteKey = demo ? 'evchargingstation:demo-favorites:v1' : 'evchargingstation:favorites:v1';
const sharedFilters = { query: (params.get('q') || '').slice(0, 200), connector: ['combo', 'ac', 'nacs', 'chademo', 'ac3', 'combo2'].includes(params.get('connector')) ? params.get('connector') : '', minPower: [50, 100, 200, 300].includes(Number(params.get('kw'))) ? Number(params.get('kw')) : 0, available: params.get('available') === '1', unrestricted: params.get('public') === '1', freeParking: params.get('parking') === '1', speed: Object.hasOwn(SPEEDS,params.get('speed')) ? params.get('speed') : '', operator: (params.get('operator') || '').slice(0,160), open24: params.get('open24') === '1', sort: ['available', 'distance', 'name', 'count', 'power'].includes(params.get('sort')) ? params.get('sort') : 'available' };
const state = { manifest: null, fees: null, regions: new Map(), activeCodes: [], national: null, detail: null, detailEpoch: 0, filters: { ...DEFAULT_FILTERS, ...sharedFilters }, favorites: readFavorites(), region: params.get('region') || (params.get('q') ? 'all' : 'auto'), bounds: null, selectedId: null, listLimit: 60, loading: false, error: '', partialError: '', visible: [], summaries: new Map(), center: sharedView?.center || { lat: 37.5665, lng: 126.978 }, demo, sharedId: params.get('station'), loadEpoch: 0, navigationRevision: 0 };
let automaticNational = false;
let map = null;
let preserveSelectedView = false;
let toastTimer;
let boundsTimer;
let inputTimer;
let refreshTimer;
let demoRegion;
let mapSearchPending = false;
let selectedListFrame = 0;
let selectionOrigin = 'list';
let listScrollSelection;
let mobileFocus = null;

mobileFocus = createMobileMapFocus({
  root: $('appLayout'),
  dialog: $('stationDialog'),
  results: $('results'),
  resultCount: $('resultCount'),
  favoriteCount: $('favoriteCount'),
  onResize: () => map?.resize(),
  onRefocus: () => {
    const station = currentStation();
    if (station && hasCoordinates(station)) map?.focus(station, { zoom: map?.getZoom?.() || 16 });
  },
  onMapTypeState: () => ({ supported: Boolean(map?.supportsMapType?.()), type: map?.getMapType?.() || 'normal' }),
  onToggleMapType: () => map?.toggleMapType?.(),
  onFavorites: () => $('favoriteToggle')?.click(),
  onCloseDetail: options => closeDetails(options)
});

function cancelSelectedListReveal() {
  cancelAnimationFrame(selectedListFrame);
  selectedListFrame = 0;
}

function queueSelectedListReveal(id) {
  if (selectionOrigin === 'scroll') return;
  cancelAnimationFrame(selectedListFrame);
  selectedListFrame = requestAnimationFrame(() => {
    selectedListFrame = 0;
    if (state.selectedId === String(id)) { listScrollSelection?.suppress(); revealSelectedCard($('listContent'), id); }
  });
}
const costDrafts = new Map();

function fillOperators(stations) {
  const operators = new Map(stations.map(station => [operatorKey(station), station.operatorName || station.operatorId]).filter(([key]) => key));
  if (state.filters.operator && !operators.has(state.filters.operator)) operators.set(state.filters.operator, '선택한 운영사 · 현재 지역에 없음');
  const html = '<option value="">전체 운영사</option>' + [...operators].sort((a,b) => String(a[1]).localeCompare(String(b[1]),'ko')).map(([key,label]) => `<option value="${esc(key)}">${esc(label)}</option>`).join('');
  if ($('operatorSelect').innerHTML !== html) $('operatorSelect').innerHTML = html;
  $('operatorSelect').value = state.filters.operator;
}
let appliedBounds = null;
let initialLocation = null;
let locationFailure = '';
let locationRequest = null;
let initialRegionPending = !demo && !['auto','all'].includes(state.region) && !sharedView && !state.sharedId;

/** Handle hidden/zero-size maps and asynchronous SDK centering at startup. */
function initialVisibleBounds(center, sdkBounds, zoom = 14) {
  if (hasCoordinates(center) && sdkBounds
    && ['south', 'north', 'west', 'east'].every(key => Number.isFinite(sdkBounds[key]))
    && sdkBounds.north > sdkBounds.south + 0.0005
    && sdkBounds.east > sdkBounds.west + 0.0005
    && center.lat >= sdkBounds.south && center.lat <= sdkBounds.north
    && center.lng >= sdkBounds.west && center.lng <= sdkBounds.east) return sdkBounds;
  const radius = zoom >= 16 ? 0.03 : zoom >= 14 ? 0.065 : 0.16;
  return { south: center.lat - radius, north: center.lat + radius,
    west: center.lng - radius * 1.5, east: center.lng + radius * 1.5 };
}

function requestLocation() {
  if (locationRequest) return locationRequest;
  if (typeof isSecureContext !== 'undefined' && !isSecureContext || !navigator.geolocation) return Promise.reject(new Error('브라우저 위치 기능을 사용할 수 없습니다. 지역을 직접 선택해 주세요.'));
  locationRequest = new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(position => {
      const point = { lat: position.coords.latitude, lng: position.coords.longitude };
      if (hasCoordinates(point)) resolve(point);
      else reject(new Error('현재 위치 좌표가 올바르지 않습니다.'));
    }, error => reject(new Error(error.code === 1
      ? '위치 권한이 차단되어 있습니다. 브라우저의 사이트 위치 권한을 허용하거나 지역을 선택해 주세요.'
      : error.code === 3 ? '위치 확인이 지연됩니다. 내 위치 버튼으로 재시도하거나 지역을 선택해 주세요.'
      : '위치를 확인할 수 없습니다. 내 위치 버튼으로 재시도하거나 지역을 선택해 주세요.')),
    { enableHighAccuracy: false, timeout: 11000, maximumAge: 60000 });
  }).finally(() => { locationRequest = null; });
  return locationRequest;
}

async function initialGeolocation() {
  if (demo || sharedView || state.sharedId || state.region !== 'auto') return;
  try {
    const permission = await navigator.permissions?.query?.({ name: 'geolocation' }).catch(() => null);
    if (permission?.state === 'denied') {
      locationFailure = '위치 권한이 차단되어 있습니다. 내 위치 버튼 또는 지역 선택을 이용하세요.';
      return;
    }
    const point = await requestLocation();
    initialLocation = point;
    state.center = point;
    locationFailure = '';
  } catch (error) { locationFailure = error.message || '위치 확인에 실패했습니다. 지역을 선택해 주세요.'; }
}


function updateMapSearchButton() {
  const button = $('searchThisArea');
  if (!button) return;
  button.hidden = !mapSearchPending;
  button.disabled = state.loading;
}

function cancelMapSearch() {
  clearTimeout(boundsTimer);
  mapSearchPending = false;
  updateMapSearchButton();
}

async function searchCurrentMap() {
  clearTimeout(boundsTimer);
  mapSearchPending = false;
  updateMapSearchButton();
  if (!state.manifest || !state.bounds) return;
  appliedBounds = state.bounds;
  state.center = map?.getCenter() || state.center;
  state.region = 'auto';
  automaticNational = false;
  $('regionSelect').value = 'auto';
  state.sharedId = null;
  state.listLimit = 60;
  updateMapSearchButton();
  // A new viewport may arrive while a shard is loading. loadEpoch prevents an
  // older response from replacing it; cached shards still need a fresh render.
  await loadRegions();
  $('listContent').scrollTop = 0;
}

function mapBoundsChanged(bounds, { source = 'user' } = {}) {
  state.bounds = bounds;
  // A nationwide search must survive panning or focusing a distant result.
  // The explicit area-search button can return to the current viewport.
  if (state.region === 'all') {
    state.center = map?.getCenter() || state.center;
    if (source === 'user') { mapSearchPending = true; render(); updateMapSearchButton(); }
    return;
  }
  // Region selections and station focus move the map internally. Retain their
  // list until the user actually explores the map; resize follows auto mode.
  if (source !== 'user' && (state.region !== 'auto' || state.selectedId || state.sharedId)) return;
  if (source === 'user') {
    state.navigationRevision++;
    initialRegionPending = false;
    cancelSelectedListReveal();
  }
  appliedBounds = bounds;
  state.center = map?.getCenter() || { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
  state.region = 'auto';
  $('regionSelect').value = 'auto';
  state.sharedId = null;
  mapSearchPending = true;
  updateMapSearchButton();
  clearTimeout(boundsTimer);
  // The adapter waits 350 ms after the final pan/zoom event. Coalesce any
  // remaining layout events before applying the latest viewport automatically.
  boundsTimer = setTimeout(() => {
    void searchCurrentMap().catch(error => {
      state.partialError = error.message || '지도 주변 정보를 불러오지 못했습니다.';
      state.loading = false;
      render();
    });
  }, 100);
}

function readFavorites() {
  try { const value = JSON.parse(localStorage.getItem(favoriteKey) || '[]'); return new Set(Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 1000) : []); }
  catch { return new Set(); }
}

function writeFavorites() {
  try { localStorage.setItem(favoriteKey, JSON.stringify([...state.favorites])); }
  catch { toast('이 브라우저에서는 저장이 유지되지 않을 수 있습니다.'); }
}

function toast(message) {
  clearTimeout(toastTimer);
  // A modal dialog is in the browser's top layer; its feedback must be there too.
  ($('stationDialog').open ? $('stationDialog') : document.body).append($('toast'));
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3400);
}

function formatTime(value, full = false) {
  if (!value) return '확인 시각 없음';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '확인 시각 없음';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...(full ? { year: 'numeric', month: '2-digit', day: '2-digit' } : { month: 'numeric', day: 'numeric' }), hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function relativeTime(value) {
  if (value === null || value === undefined) return '확인 시각 없음';
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time) || time > Date.now() + 60000) return '확인 시각 검증 필요';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return '방금 확인';
  if (minutes < 60) return `${minutes}분 전 확인`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전 확인`;
  return `${Math.floor(minutes / 1440)}일 전 확인`;
}

const threshold = () => Number(state.manifest?.freshnessThresholdSeconds || config.freshnessThresholdSeconds) || 600;
const stationRegion = station => state.detail?.station.id === station.id ? state.detail.region : state.regions.get(String(station.regionCode));
const allStations = () => {
  const stations = state.region === 'all' ? state.national?.stations || [] : state.activeCodes.flatMap(code => state.regions.get(code)?.stations || []);
  return liveStatus.entries.size ? stations.map(station=>liveStatus.apply(station,stationRegion(station))) : stations;
};
const currentStation = () => {
  const candidate = allStations().find(station => String(station.id) === state.selectedId);
  return candidate?.summaryOnly && state.detail?.station.id === state.selectedId ? liveStatus.apply(state.detail.station,state.detail.region) : candidate;
};

async function refreshSelectedStatus() {
  const station = currentStation();
  if (!liveStatus.enabled || !station || station.summaryOnly || !$('stationDialog').open || document.hidden) return;
  const task = liveStatus.refresh(station);
  renderDetails(currentStation());
  await task;
  // A late reply may update its cache, but must not reopen a closed/new panel.
  if (state.selectedId !== station.id || !$('stationDialog').open) return;
  render();
  const current = currentStation();
  if (current && !current.summaryOnly) renderDetails(current);
}

function updateControls() {
  $('availableToggle').setAttribute('aria-pressed', String(state.filters.available));
  $('unrestrictedToggle').setAttribute('aria-pressed', String(state.filters.unrestricted));
  $('favoriteToggle').setAttribute('aria-pressed', String(state.filters.favorites));
  $('favoriteCount').textContent = state.favorites.size.toLocaleString('ko-KR');
  $('connectorSelect').value = state.filters.connector;
  $('powerSelect').value = String(state.filters.minPower);
  $('freeParkingCheck').checked = state.filters.freeParking;
  $('open24Check').checked = state.filters.open24;
  $('speedSelect').value = state.filters.speed;
  $('sortSelect').value = state.filters.sort;
  $('searchInput').value = state.filters.query;
  $('clearSearch').hidden = !state.filters.query;
  $('regionSelect').value = state.region;
  $('searchLabel').textContent = state.region === 'all' ? '전국 충전소명 또는 주소 검색' : state.region === 'auto' ? '충전소명 또는 주소 검색 · 입력하면 전국 검색' : '선택한 지역의 충전소명 또는 주소 검색';
  $('searchInput').placeholder = state.region === 'all' || state.region === 'auto' ? '충전소명·주소 전국 검색' : '선택 지역 충전소명·주소 검색';
  const count = Number(Boolean(state.filters.minPower)) + Number(state.filters.freeParking) + Number(state.filters.open24) + Number(Boolean(state.filters.speed)) + Number(Boolean(state.filters.operator));
  $('extraFilterCount').textContent = count;
  $('extraFilterCount').hidden = !count;
  for (const id of ['refreshButton', 'mapRefreshButton']) {
    $(id).disabled = state.loading;
    $(id).classList.toggle('refreshing', state.loading);
  }
}

function setMode() {
  const mode = demo ? 'demo' : state.manifest?.mode || 'unconfigured';
  const coverage = Date.parse(state.manifest?.statusCoverageAt);
  const delayed = !demo && state.manifest?.totalStations > 0 && (!Number.isFinite(coverage) || coverage > Date.now() + 60000 || Date.now() - coverage > threshold() * 1000);
  const labels = { demo: '예시 데이터', live: delayed ? '상태 갱신 지연' : '상태 자동 갱신', snapshot: delayed ? '상태 갱신 지연' : '수집 시점 데이터', unconfigured: '데이터 연결 준비' };
  $('modeBadge').className = `mode-badge ${mode}${delayed ? ' delayed' : ''}`;
  $('modeBadge').innerHTML = `<span class="status-dot"></span><span class="mode-label">${esc(labels[mode] || '데이터 확인 필요')}</span>${icon('info')}`;
  $('modeBadge').setAttribute('aria-label', `${labels[mode] || '데이터 확인 필요'} · 수집 현황 및 확인 시각`);
  $('demoBanner').hidden = !demo;
  document.body.classList.toggle('is-demo', demo);
  $('inventoryTime').textContent = `시설 정보 갱신 시각: ${formatTime(state.manifest?.inventoryUpdatedAt, true)} (한국 시간)`;
}

function scopeLabel() {
  const names = (state.manifest?.regions || []).filter(entry => state.activeCodes.includes(String(entry.code))).map(entry => entry.name);
  if (demo) return `${state.region === 'all' ? '전체 예시' : '지도 화면 안'} · 화면 체험용 가상 충전소`;
  if (state.region === 'all') return `${state.loading ? '전국 검색 자료 불러오는 중' : '전국 전체 · 지도 범위와 무관'}${state.filters.favorites ? ' · 저장한 곳' : ''}`;
  if (!names.length) return state.manifest?.mode === 'unconfigured' ? '실제 데이터 연결 후 검색할 수 있습니다' : '선택한 지역 안에서 검색합니다';
  const area = names.length > 1 ? `${names[0]} 외 ${names.length - 1}개 지역` : names[0];
  return `${state.region === 'auto' ? `지도 화면 안 · ${area}` : `${area} 전체`}${state.filters.favorites ? ' · 저장한 곳' : ''}`;
}

function emptyHTML() {
  if (state.error && !allStations().length) return `<div class="empty-state"><div class="empty-icon">${icon('refresh')}</div><h3>정보를 불러오지 못했습니다</h3><p>연결 상태를 확인한 후 다시 시도해 주세요.</p><div class="empty-actions"><button class="button primary" data-action="refresh">${icon('refresh')}다시 불러오기</button><a class="button" href="https://www.data.go.kr/data/15076352/openapi.do" target="_blank" rel="noopener noreferrer">데이터 출처</a></div><p class="fine-print">${esc(state.error)}</p></div>`;
  if (!demo && state.manifest?.mode === 'unconfigured') return `<div class="empty-state"><div class="empty-icon">${icon('bolt')}</div><h3>충전소 데이터를 준비하고 있습니다</h3><p>공공데이터 연결이 완료되면<br>충전소 위치와 충전 상태를 확인할 수 있습니다.</p><div class="empty-actions"><button class="button primary" data-action="refresh">${icon('refresh')}새로고침</button><a class="button" href="?demo=1">화면 체험${icon('arrow')}</a></div><p class="fine-print">화면 체험은 별도로 표시된 가상 데이터로 제공됩니다.</p></div>`;
  if (!demo && !allStations().length && state.manifest?.warnings?.some(item => item.code === 'INITIALIZING')) return `<div class="empty-state"><div class="empty-icon">${icon('refresh')}</div><h3>충전소 정보를 수집하고 있습니다</h3><p>확인이 완료되면 충전소가 자동으로 표시됩니다.<br>잠시 후 다시 확인해 주세요.</p><button class="button" data-action="refresh">${icon('refresh')}새로고침</button></div>`;
  if (state.loading) return `<div class="loading-state"><span class="loader"></span><p>${state.region === 'all' ? '전국 충전소 검색 자료를 불러오고 있습니다' : '충전소 정보를 불러오고 있습니다'}</p></div>`;
  if (!state.activeCodes.length) return `<div class="empty-state"><div class="empty-icon">${icon('pin')}</div><h3>조회할 지역을 선택해 주세요</h3><p>지역을 선택하거나 지도를 움직이면 해당 지역의 충전소를 확인할 수 있습니다.</p></div>`;
  return `<div class="empty-state"><div class="empty-icon">${icon(state.filters.favorites ? 'bookmark' : 'search')}</div><h3>${state.filters.favorites ? '이 지역에 저장한 충전소가 없습니다' : '조건에 맞는 충전소가 없습니다'}</h3><p>${state.filters.available ? '충전 대기는 최근 확인된 충전기에만 표시됩니다. 조건을 조정하거나 다른 지역을 확인해 보세요.' : '검색어와 지역, 커넥터 조건을 조정해 보세요.'}</p><button class="button" data-action="reset">검색 조건 초기화</button></div>`;
}

function stationCard(station) {
  const summary = state.summaries.get(station.id);
  const region = stationRegion(station);
  const checks = (station.chargers || []).map(charger => chargerState(charger, region, Date.now(), threshold()));
  const confirmed = checks.map(check => check.confirmedAt).filter(value => value !== null);
  const mostRecent = confirmed.length ? Math.max(...confirmed) : null;
  const dist = distanceKm(state.center, station);
  const connectorNames = [...new Set((station.chargers || []).map(charger => typeInfo(charger.type).name))];
  const connectors = connectorNames.length > 2 ? `${connectorNames.slice(0, 2).join(' · ')} 외` : connectorNames.join(' · ');
  const availability = summary.available > 0 ? `<b>${summary.available}</b>기 충전 대기 <small>/ ${summary.matching}기${summary.matching !== summary.total ? ' 조건 일치' : ''}</small>` : summary.unknown ? '현재 상태 확인 필요' : '충전 대기 없음';
  const distance = Number.isFinite(dist) ? dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km` : '위치 미확인';
  const checked = `${demo ? '가상 예시 · ' : ''}${relativeTime(mostRecent)}${summary.stale && confirmed.length ? ' · 확인 지연' : ''}`;
  return `<article class="station-card${state.selectedId === station.id ? ' selected' : ''}" data-station-id="${esc(station.id)}" data-tone="${summary.tone}" aria-current="${state.selectedId === station.id}">
    <div class="station-main">
      <button type="button" class="station-name" title="${esc(station.name)}" data-action="select" data-id="${esc(station.id)}">${esc(station.name)}</button>
      <p class="station-address" title="${esc(station.address || '')}">${esc(station.address || '주소 미확인')}</p>
      <div class="card-status-row"><span class="availability ${summary.tone}">${availability}</span><span class="card-update" title="${summary.stale && confirmed.length ? '일부 충전기 확인 지연 · 상세에서 충전기별 확인 시각을 확인하세요.' : '최근 수집 확인 시각'}">${esc(checked)}</span><span class="card-distance">${esc(distance)}</span></div>
      <div class="card-specs"><span>총 ${summary.total}기</span>${summary.maxPower ? `<span>최대 ${esc(summary.maxPower)} kW</span>` : ''}<span class="card-connectors" title="${esc(connectorNames.join(' · '))}">${esc(connectors || '커넥터 미확인')}</span></div>
      <div class="card-tags">${station.restricted === true ? '<span class="warning-tag">이용 제한</span>' : ''}${summary.hasBusOnly ? '<span class="warning-tag">버스 전용 포함</span>' : ''}${isOpen24(station) ? '<span>24시간</span>' : ''}${station.parkingFree === true ? '<span>주차 무료 등록</span>' : ''}${station.operatorName ? `<span class="card-operator" title="${esc(station.operatorName)}">${esc(station.operatorName)}</span>` : ''}</div>
    </div>
    <button type="button" class="card-save" data-action="favorite" data-id="${esc(station.id)}" aria-label="${esc(station.name)} ${state.favorites.has(station.id) ? '저장 해제' : '저장'}" aria-pressed="${state.favorites.has(station.id)}">${icon('bookmark')}</button>
  </article>`;
}

function render() {
  const stations = allStations();
  // Screen-wide province snapshots can contain tens of thousands of records.
  // Narrow to the applied viewport before per-charger summarization and sorting.
  const scopedStations = state.region === 'auto' && appliedBounds
    ? stations.filter(station => insideMapBounds(station, appliedBounds))
    : stations;
  fillOperators(scopedStations);
  const now = Date.now();
  state.visible = filterStations(scopedStations, state.regions, state.filters, state.favorites, now, threshold());
  state.summaries = new Map(state.visible.map(station => [station.id, summarizeStation(station, stationRegion(station), state.filters, now, threshold())]));
  const distances = new Map(state.visible.map(station => [station.id,distanceKm(state.center,station)]));
  state.visible.sort((a,b) => compareStations(a,b,state.filters.sort,state.summaries,state.center,distances));
  $('resultCount').textContent = state.manifest ? state.visible.length.toLocaleString('ko-KR') : '—';
  $('scopeLabel').textContent = scopeLabel();
  const shown = state.visible.slice(0, state.listLimit);
  const list = $('listContent');
  const previousListScroll = list.scrollTop;
  listScrollSelection?.suppress();
  // Keep the ad node and its iframe connected while result cards change.
  listAds.render({shown,total:state.visible.length,card:stationCard,empty:emptyHTML(),more:state.visible.length > shown.length ? `<button type="button" class="button show-more" data-action="more">충전소 더 보기 (${shown.length.toLocaleString('ko-KR')} / ${state.visible.length.toLocaleString('ko-KR')})</button>` : ''});
  list.scrollTop = previousListScroll;
  syncAds();
  if (state.selectedId) queueSelectedListReveal(state.selectedId);
  const warningCodes = new Set((state.manifest?.warnings || []).map(item => item.code));
  const knownWarnings = new Set(['NOT_CONFIGURED', 'UNCONFIGURED', 'INITIALIZING', 'INVALID_COORDINATES']);
  const collectionFailed = [...warningCodes].some(code => !knownWarnings.has(code));
  const warnings = [locationFailure, warningCodes.has('INITIALIZING') && stations.length ? '최신 충전소 정보를 수집하고 있습니다.' : '', warningCodes.has('INVALID_COORDINATES') ? '위치 정보가 없는 충전소는 목록에서 확인할 수 있습니다.' : '', collectionFailed ? '데이터 갱신이 지연되고 있습니다. 마지막으로 확인된 정보와 확인 시각을 확인해 주세요.' : ''].filter(Boolean);
  const issue = [state.partialError, state.error && stations.length ? `${state.error} 마지막으로 확인한 정보를 표시합니다.` : '', ...warnings].filter(Boolean).join(' ');
  $('resultNoticeSummary').textContent = state.partialError ? '일부 데이터 확인 필요 · 자세히' : locationFailure ? '위치 확인 안내 · 자세히' : '데이터 갱신 안내 · 자세히';
  $('resultNoticeDetail').textContent = issue;
  $('resultNotice').hidden = !issue;
  if (!issue) $('resultNotice').open = false;
  $('scopeLabel').title = (state.manifest?.regions || []).filter(entry => state.activeCodes.includes(String(entry.code))).map(entry => entry.name).join(' · ');
  $('viewFilterResults').textContent = `${state.visible.length.toLocaleString('ko-KR')}곳 결과 보기`;
  const waiting = state.visible.reduce((sum, station) => sum + state.summaries.get(station.id).available, 0);
  $('mapSummary').innerHTML = `${icon('pin')}<span>${state.visible.length ? `${demo ? '가상 예시 · ' : ''}충전소 <b>${state.visible.length.toLocaleString('ko-KR')}</b>곳 <span aria-hidden="true">·</span> 충전 대기 <b>${waiting.toLocaleString('ko-KR')}</b>기` : state.manifest?.mode === 'unconfigured' ? '충전소 데이터 연결을 준비하고 있습니다' : '지도를 움직여 주변을 탐색하세요'}</span>`;
  $('mapEmpty').hidden = true;
  const freshest = [...state.regions.values()].filter(region => state.activeCodes.includes(String(region.regionCode))).map(region => region.statusCoverageAt || region.generatedAt).filter(Boolean).sort().at(-1);
  $('freshnessLine').querySelector('span').textContent = demo ? '가상 예시 · 실제 충전 상태가 아닙니다' : state.manifest?.mode === 'unconfigured' ? '연결 후 충전기별 확인 시각을 표시합니다' : freshest ? `지역 데이터 ${relativeTime(freshest)} · 상태는 충전기별 확인` : '충전 상태 확인 시각을 함께 표시합니다';
  updateControls();
  updateMapSearchButton();
  setMode();
  map?.setStations(state.visible, { selectedId: state.selectedId, summaries: state.summaries });
}

function fillRegions() {
  $('regionSelect').innerHTML = '<option value="auto">지도 주변</option><option value="all">전국 전체</option>' + (state.manifest?.regions || []).map(region => `<option value="${esc(region.code)}">${esc(region.name)}</option>`).join('');
  if (!['auto','all'].includes(state.region) && !(state.manifest?.regions || []).some(region => String(region.code) === state.region)) state.region = 'auto';
  $('regionSelect').value = state.region;
}

function showRegionOnMap() {
  const entry = state.manifest?.regions.find(region => String(region.code) === state.region);
  const center = entry?.center || (entry?.bounds && {
    lat: (entry.bounds.south + entry.bounds.north) / 2,
    lng: (entry.bounds.west + entry.bounds.east) / 2,
  });
  if (!center || !hasCoordinates(center)) return;
  appliedBounds = null;
  state.center = center;
  map?.setCenter(center, 10);
}

function regionEntries() {
  const entries = state.manifest?.regions || [];
  if (state.region !== 'auto') return entries.filter(region => String(region.code) === state.region);
  const bounds = appliedBounds || state.bounds || { south: state.center.lat - .05, north: state.center.lat + .05, west: state.center.lng - .08, east: state.center.lng + .08 };
  return selectViewportRegions(entries, bounds, 4);
}

async function fetchRegion(entry, force) {
  try { return await client.region(entry, { force }); }
  catch (error) {
    if (!String(error.message).includes('(404)')) throw error;
    // Immutable release paths may expire between the manifest and region request.
    const freshManifest = await client.manifest();
    const updated = freshManifest.regions.find(region => String(region.code) === String(entry.code));
    if (!updated || updated.path === entry.path) throw error;
    state.manifest = freshManifest;
    return client.region(updated, { force: true });
  }
}

async function loadRegions(force = false) {
  if (!state.manifest) return;
  if (state.region === 'all') return loadNationwide();
  const entries = regionEntries();
  const codes = entries.map(region => String(region.code));
  const epoch = ++state.loadEpoch;
  if (!force && codes.join(',') === state.activeCodes.join(',') && codes.every(code => Array.isArray(state.regions.get(code)?.stations))) { state.loading = false; render(); return; }
  state.activeCodes = codes;
  state.loading = true;
  state.partialError = '';
  render();
  const results = await Promise.allSettled(entries.map(async entry => {
    const region = demo ? demoRegion : await fetchRegion(entry, force);
    if (!demo && region.mode === 'demo') throw new Error('실제 데이터에서 예시 데이터가 감지되었습니다.');
    return region;
  }));
  if (epoch !== state.loadEpoch) return;
  let failed = 0;
  results.forEach((result, index) => { if (result.status === 'fulfilled') state.regions.set(codes[index], result.value); else { failed++; console.warn('Region data unavailable:', codes[index], result.reason.message); } });
  // Only active viewport provinces should retain decompressed station arrays in memory.
  for (const code of state.regions.keys()) if (!codes.includes(code)) state.regions.delete(code);
  state.loading = false;
  if (failed) state.partialError = `${failed}개 지역을 갱신하지 못했습니다. 새로고침으로 다시 확인해 주세요.`;
  const incomplete = codes.some(code => state.regions.get(code)?.complete === false);
  if (incomplete) state.partialError = '일부 충전소 정보의 수집이 완료되지 않았습니다. 확인된 정보를 표시합니다.';
  render();
  if (state.sharedId) {
    const station = allStations().find(item => item.id === state.sharedId);
    if (station) { state.sharedId = null; selectStation(station.id, { preserveView: Boolean(sharedView) }); }
    else if (!failed && codes.length) { state.sharedId = null; toast('공유된 충전소를 이 지역에서 찾지 못했습니다.'); }
  }
  if ($('stationDialog').open && state.selectedId) {
    const station = currentStation();
    if (station) renderDetails(station);
    else { closeDetails(); toast('갱신된 데이터에서 이 충전소를 찾을 수 없습니다. 목록을 다시 확인해 주세요.'); }
  }
}

async function loadNationwide() {
  const epoch = ++state.loadEpoch;
  state.loading = true;
  state.partialError = '';
  state.error = '';
  render();
  try {
    let data;
    if (demo) data = {stations:demoRegion.stations,regions:new Map([[String(demoRegion.regionCode),demoRegion]])};
    else {
      try { data = await client.nationwide(state.manifest.searchIndex); }
      catch (error) {
        if (!String(error.message).includes('(404)')) throw error;
        const freshManifest = await client.manifest();
        if (epoch !== state.loadEpoch) return;
        state.manifest = freshManifest;
        data = await client.nationwide(freshManifest.searchIndex);
      }
    }
    if (epoch !== state.loadEpoch) return;
    state.national = data;
    state.regions = new Map(data.regions);
    state.activeCodes = [...data.regions.keys()];
    state.loading = false;
    render();
    const id = state.sharedId || ($('stationDialog').open ? state.selectedId : null);
    if (id) {
      state.sharedId = null;
      if (data.stations.some(station => station.id === id)) await selectStation(id,{preserveView:Boolean(sharedView) || id === state.selectedId,origin:selectionOrigin});
      else { if ($('stationDialog').open) closeDetails(); toast('갱신된 전국 자료에서 이 충전소를 찾지 못했습니다.'); }
    }
  } catch (error) {
    if (epoch !== state.loadEpoch) return;
    state.loading = false;
    state.error = error.message || '전국 검색 자료를 불러오지 못했습니다.';
    render();
  }
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  state.error = '';
  render();
  try {
    if (demo) { const { createDemo } = await import('./demo.js'); const data = createDemo(); state.manifest = data.manifest; demoRegion = data.region; }
    else {
      const [manifest, fees] = await Promise.all([
        client.manifest(),
        client.fees().catch(error => { console.warn('Tariff guidance unavailable:', error.message); return null; }),
      ]);
      state.manifest = manifest;
      state.fees = fees;
      if (state.manifest.mode === 'demo') throw new Error('실제 데이터 연결을 확인해 주세요.');
    }
    fillRegions();
    // Region links arrive before the manifest. Center once when its region is
    // known, preserving shared map positions and later pans or refreshes.
    if (initialRegionPending) { initialRegionPending = false; showRegionOnMap(); }
    await loadRegions(true);
    void refreshSelectedStatus();
  } catch (error) { state.error = error.message || '네트워크 연결을 확인해 주세요.'; state.loading = false; render(); }
}

async function resetFilters() {
  clearTimeout(inputTimer);
  if (automaticNational && state.region === 'all') { await changeFilters({...DEFAULT_FILTERS}); return; }
  state.filters = { ...DEFAULT_FILTERS };
  state.listLimit = 60;
  render();
  const station = currentStation();
  if (station && $('stationDialog').open) renderDetails(station);
}

async function changeFilters(patch) {
  let reload = false;
  if (Object.hasOwn(patch,'query')) {
    if (String(patch.query).trim() && state.region === 'auto') {
      state.region = 'all'; automaticNational = true; cancelMapSearch(); reload = true;
    } else if (!String(patch.query).trim() && automaticNational && state.region === 'all') {
      state.region = 'auto'; automaticNational = false; appliedBounds = state.bounds; reload = true;
    }
  }
  state.filters = { ...state.filters, ...patch };
  if (Object.hasOwn(patch,'query') && String(patch.query).trim() && window.matchMedia?.('(max-width:760px)').matches) setMobileView('list');
  state.listLimit = 60;
  if (reload) await loadRegions();
  render();
  $('listContent').scrollTop = 0;
  const station = currentStation();
  if (station && $('stationDialog').open) renderDetails(station);
}

function nearbyHTML(station) {
  const alternatives = nearbyAlternatives(station,allStations(),state.regions,state.filters,Date.now(),threshold());
  return `<section class="detail-section"><h3>인근 대안 충전소</h3><p class="detail-freshness">현재 불러온 지역에서 직선거리 5 km 이내 · 선택한 커넥터·속도·이용 조건 기준</p>${alternatives.length ? alternatives.map(candidate => {
    const summary = summarizeStation(candidate,stationRegion(candidate),state.filters,Date.now(),threshold());
    const distance = distanceKm(station,candidate);
    return `<button type="button" class="nearby-station" data-action="nearby" data-id="${esc(candidate.id)}"><strong>${esc(candidate.name)}</strong><span>${distance < 1 ? `${Math.round(distance*1000)} m` : `${distance.toFixed(1)} km`} · ${summary.matching}기 조건 일치 · ${esc(summary.label)}</span><small>${candidate.restricted === true ? '이용 제한 있음' : candidate.restricted === false ? '이용 제한 없음으로 등록' : '출입 조건 확인 필요'} · ${candidate.parkingFree === true ? '주차 무료 등록' : '주차 요금 확인'}</small></button>`;
  }).join('') : '<p class="detail-freshness">현재 불러온 범위에 조건이 맞는 대안이 없습니다. 지역 또는 조건을 조정해 보세요.</p>'}</section>`;
}

function costHTML(station) {
  const draft = costDrafts.get(station.id) || {energy:'20',price:''};
  return `<section class="detail-section"><h3>예상 충전 비용 계산</h3><p class="detail-freshness">운영사에서 확인한 단가를 직접 입력하세요. 회원·비회원·로밍·출력 구간에 따라 단가가 달라집니다.</p><div class="cost-fields"><label>충전량 (kWh)<input id="costEnergy" type="number" inputmode="decimal" min="0.1" max="1000" step="0.1" value="${esc(draft.energy)}"></label><label>확인한 단가 (원/kWh)<input id="costPrice" type="number" inputmode="decimal" min="0.1" max="5000" step="0.1" placeholder="직접 입력" value="${esc(draft.price)}"></label></div><output id="costResult" class="cost-result" for="costEnergy costPrice" aria-live="polite"></output><p class="detail-freshness">입력한 단가 × 충전량의 참고값입니다. 주차비·로밍 할증·할인은 포함하지 않습니다.</p></section>`;
}

function updateCost() {
  const energy = $('costEnergy'), price = $('costPrice');
  if (!energy || !price) return;
  costDrafts.set(state.selectedId,{energy:energy.value,price:price.value});
  const value = estimateChargingCost(energy.value,price.value);
  $('costResult').textContent = value === null ? '충전량과 단가를 입력하면 예상 비용을 표시합니다.' : `예상 충전 비용 ${value.toLocaleString('ko-KR')}원`;
}

function favorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
  writeFavorites();
  render();
  const station = currentStation();
  if (station && $('stationDialog').open) renderDetails(station);
}

async function selectStation(id, { preserveView = false, origin = 'list' } = {}) {
  let station = allStations().find(item => item.id === id);
  if (!station) return;
  selectionOrigin = origin;
  if (origin !== 'scroll') listScrollSelection?.suppress();
  const revision = ++state.detailEpoch;
  if (station.summaryOnly) {
    const epoch = state.loadEpoch;
    const entry = state.manifest.regions.find(item => String(item.code) === station.regionCode);
    const sameOpen = $('stationDialog').open && state.selectedId === id && state.detail?.station.id === id;
    state.selectedId = id;
    render();
    if (hasCoordinates(station) && !preserveView) {
      map?.focus(station, { zoom: origin === 'scroll' ? map?.getZoom?.() || 14 : Math.max(16, map?.getZoom?.() || 16) });
    }
    if (!sameOpen) {
      $('detailContent').dataset.stationId = '';
      $('detailContent').innerHTML = `<div class="detail-toolbar"><h2 id="detailTitle">${esc(station.name)}</h2><button class="icon-button close-detail" type="button" data-action="close" aria-label="충전소 상세 닫기">${icon('close')}</button></div><div class="loading-state"><span class="loader"></span><p>충전소 상세 정보를 불러오고 있습니다</p></div>`;
      if (!$('stationDialog').open) $('stationDialog').show();
      syncAds();
      if (mobileFocus?.isActive()) {
        $('appLayout').classList.add('mobile-map');
        mobileFocus.openDetail();
        mobileFocus.decorateDetail();
      }
      $('stationDialog').scrollTop = 0;
    }
    try {
      if (!entry) throw new Error('이 충전소의 지역 정보를 확인할 수 없습니다. 새로고침해 주세요.');
      const region = await fetchRegion(entry,false);
      if (revision !== state.detailEpoch || epoch !== state.loadEpoch || state.selectedId !== id) return;
      station = region.stations.find(item => item.id === id);
      if (!station) throw new Error('이 충전소의 상세 정보를 찾을 수 없습니다.');
      state.detail = {station,region};
    } catch (error) {
      if (revision !== state.detailEpoch || epoch !== state.loadEpoch) return;
      if (sameOpen) { toast('상세 갱신에 실패해 이전 확인 정보를 유지합니다.'); return; }
      $('detailContent').innerHTML = `<div class="detail-toolbar"><h2 id="detailTitle">상세 정보 확인 필요</h2><button class="icon-button close-detail" type="button" data-action="close" aria-label="충전소 상세 닫기">${icon('close')}</button></div><section class="detail-section"><p>${esc(error.message)}</p><button type="button" class="button" data-action="retry-detail">다시 불러오기</button></section>`;
      return;
    }
  }
  cancelMapSearch();
  state.navigationRevision++;
  state.selectedId = id;
  preserveSelectedView = preserveView;
  const index = state.visible.findIndex(item => String(item.id) === String(id));
  if (origin === 'map' && index >= state.listLimit) state.listLimit = Math.ceil((index + 1) / 60) * 60;
  render();
  if (hasCoordinates(station) && !preserveView) map?.focus(station, { zoom: origin === 'scroll' ? map?.getZoom?.() || 14 : Math.max(16, map?.getZoom?.() || 16) });
  renderDetails(station);
  // Nonmodal panel preserves an interactive, unblurred map and list.
  if (!$('stationDialog').open) $('stationDialog').show();
  syncAds();
  if (mobileFocus?.isActive()) {
    $('appLayout').classList.add('mobile-map');
    mobileFocus.openDetail();
    mobileFocus.decorateDetail();
  }
  queueSelectedListReveal(id);
  void refreshSelectedStatus();
}

function closeDetails({ fromHistory = false } = {}) {
  if (mobileFocus?.isActive() && !fromHistory && mobileFocus.requestHistoryClose()) return;
  state.detailEpoch++;
  state.detail = null;
  cancelSelectedListReveal();
  if ($('stationDialog').open) $('stationDialog').close();
  syncAds();
  document.body.append($('toast'));
  if (mobileFocus?.isActive()) {
    preserveSelectedView = true;
    mobileFocus.afterDetailClosed({ fromHistory: true });
    map?.setStations(state.visible, { selectedId: state.selectedId, summaries: state.summaries });
    return;
  }
  state.selectedId = null;
  preserveSelectedView = false;
  map?.setStations(state.visible, { selectedId: null, summaries: state.summaries });
  document.querySelector('.station-card.selected')?.classList.remove('selected');
}

function selectScrolledStation(id) {
  if (document.hidden || state.loading || state.selectedId === id) return;
  const station = state.visible.find(item=>String(item.id) === id);
  if (!station) return;
  cancelSelectedListReveal();
  selectionOrigin = 'scroll';
  if ($('stationDialog').open) {
    // Preserve the user's list position; an already-open detail follows selection.
    void selectStation(id,{origin:'scroll'});
    return;
  }
  state.detailEpoch++;
  state.detail = null;
  state.selectedId = id;
  state.navigationRevision++;
  cancelMapSearch();
  for (const card of $('listContent').querySelectorAll('.station-card')) {
    const selected = card.dataset.stationId === id;
    card.classList.toggle('selected',selected);
    card.setAttribute('aria-current',String(selected));
  }
  map?.setStations(state.visible,{selectedId:id,summaries:state.summaries});
  if (hasCoordinates(station)) map?.focus(station,{zoom:map?.getZoom?.() || 14});
}

function renderDetails(station) {
  if (station.summaryOnly) return; // Never present a compact search row as a complete detail record.
  const dialog = $('stationDialog');
  const content = $('detailContent');
  const sameStation = content.dataset.stationId === String(station.id);
  const focused = sameStation && content.contains(document.activeElement) ? document.activeElement : null;
  const focusedAction = focused?.dataset.action;
  const focusedHref = focused?.getAttribute('href');
  const scrollTop = dialog.scrollTop;
  const focusedInput = focused?.id;
  const focusedSection = focused?.matches('summary') ? focused.parentElement?.dataset.detailSection : null;
  const openSections = new Set(sameStation
    ? [...content.querySelectorAll('details[open][data-detail-section]')].map(item => item.dataset.detailSection) : []);
  const region = stationRegion(station);
  const phone = safePhone(station.phone);
  const restricted = station.restricted === true ? `이용 제한 있음${station.restrictionReason ? ` · ${station.restrictionReason}` : ''}` : station.restricted === false ? '이용 제한 없음으로 등록' : '이용 제한 여부 미확인';
  const parking = station.parkingFree === true ? '주차 무료로 등록' : station.parkingFree === false ? '주차 유료로 등록 · 금액은 현장 확인' : '주차 요금 미확인';
  const facilityText = station.facilityKind
    ? `${esc(facilityName(station))}${station.facilityDetailCode ? ` · ${esc(facilityDetailName(station))}` : ''}`
    : '시설 유형 미확인';
  const convenience = station.convenienceProvided === true ? '편의제공 있음으로 등록 (종류 미확인)' : station.convenienceProvided === false ? '편의제공 없음으로 등록' : '편의제공 여부 미확인';
  const nav = hasCoordinates(station) && !demo;
  const naver = !demo ? `https://map.naver.com/p/search/${encodeURIComponent(station.address || station.name)}` : '';
  const kakao = nav ? `https://map.kakao.com/link/to/${encodeURIComponent(station.name)},${station.lat},${station.lng}` : '';
  const now = Date.now();
  const options = {now, threshold:threshold(), demo, formatTime, filters:state.filters,
    liveStatus:liveStatus.enabled ? liveStatus.state(station.id) : null};
  content.innerHTML = `
    <div class="detail-toolbar"><h2 id="detailTitle">${esc(station.name)}</h2><button class="icon-button close-detail" type="button" data-action="close" aria-label="충전소 상세 닫기">${icon('close')}</button></div>
    <div class="detail-top"><p class="detail-eyebrow">${demo ? '화면 체험 · 가상 충전소' : esc(station.operatorName || '운영사 미확인')}</p>
      <p class="detail-address">${esc(station.address || '주소 미확인')}${station.address ? `<button class="icon-button" type="button" data-action="copy-address" aria-label="주소 복사">${icon('copy')}</button>` : ''}${station.detailAddress ? `<br>${esc(station.detailAddress)}` : ''}</p>
      <div class="detail-actions">${nav ? `<a class="button primary" href="${esc(naver)}" target="_blank" rel="noopener noreferrer">${icon('nav')}네이버 지도</a><a class="button" href="${esc(kakao)}" target="_blank" rel="noopener noreferrer">카카오 길찾기</a>` : `<button class="button" type="button" data-action="${demo ? 'demo-navigation' : 'missing-location'}">${icon('nav')}${demo ? '예시 위치' : '위치 미확인'}</button>`}
        <button class="button icon-only" type="button" data-action="detail-favorite" aria-label="${state.favorites.has(station.id) ? '저장 해제' : '충전소 저장'}" aria-pressed="${state.favorites.has(station.id)}">${icon('bookmark')}</button>
        <button class="button icon-only" type="button" data-action="share" aria-label="충전소 공유">${icon('share')}</button></div></div>
    ${demo ? '<div class="detail-demo"><strong>화면 체험용 가상 정보입니다.</strong><br>실제 충전소나 이용 가능한 충전 상태를 나타내지 않습니다.</div>' : ''}
    <section class="detail-section"><h3>충전 상태 한눈에</h3>${statusSummaryHTML(station, region, options)}</section>
    <section class="detail-section"><h3>방문 전 확인</h3><div class="visit-checks">
      <span>${esc(isOpen24(station) ? '24시간 이용 등록' : station.useTime || '운영시간 미확인')}</span>
      <span${station.parkingFree !== true ? ' class="warning"' : ''}>${esc(station.parkingFree === true ? '주차 무료 등록' : station.parkingFree === false ? '주차 유료 등록' : '주차료 미확인')}</span>
      <span${station.restricted !== false ? ' class="warning"' : ''}>${esc(station.restricted === true ? '이용 대상 제한' : station.restricted === false ? '이용 제한 없음 등록' : '출입 조건 미확인')}</span></div>
      ${station.restrictionReason ? `<p class="visit-restriction">출입 안내: ${esc(station.restrictionReason)}</p>` : ''}</section>
    <section class="detail-section"><div class="charger-section-heading"><h3>충전기별 정보</h3><span>전체 ${(station.chargers || []).length}기</span></div>
      ${chargerRowsHTML(station, region, state.fees, options)}</section>
    <section class="detail-section"><h3>시설·이용 안내</h3><dl class="detail-info">
      <dt>운영시간</dt><dd>${esc(station.useTime || '운영시간 미확인')}</dd>
      <dt>설치 위치</dt><dd class="info-multiline">${esc(station.location || '세부 위치 미확인')}</dd>
      <dt>설치 층수</dt><dd>${esc(stationFloors(station))}</dd>
      <dt>시설 유형</dt><dd>${facilityText}</dd>
      <dt>이용 제한</dt><dd${station.restricted !== false ? ' class="warning"' : ''}>${esc(restricted)}</dd>
      <dt>주차 요금</dt><dd>${esc(parking)}</dd>
      <dt>운영사</dt><dd>${esc(station.operatorName || '운영사 미확인')}</dd>
      <dt>문의 전화</dt><dd>${phone && !demo ? `<a href="tel:${esc(phone)}">${icon('phone')} ${esc(station.phone)}</a>` : '연락처 미확인'}</dd>
      ${station.note ? `<dt>참고 사항</dt><dd class="info-multiline">${esc(station.note)}</dd>` : ''}</dl>
      <details class="charging-guide" data-detail-section="facility-record"><summary>기타 시설 등록 정보</summary><p>편의제공: ${esc(convenience)}. 편의 종류·접근성은 이 항목만으로 알 수 없습니다.</p></details>
      ${!demo ? '<p class="detail-explanation"><a class="official-fee" href="https://www.ev.or.kr/nportal/monitor/evMap.do" target="_blank" rel="noopener noreferrer">공식 지도에서 충전소명으로 검색 ↗</a></p>' : ''}</section>
    <section class="detail-section"><h3>요금 안내</h3>${demo ? '<p class="detail-explanation">화면 체험용 · 실제 요금이 아닙니다.</p>' : tariffGuideHTML(state.fees, station)}</section>
    ${costHTML(station)}
    <section class="detail-section"><h3>이용 도움말</h3>${chargingHelpHTML(threshold())}</section>${nearbyHTML(station)}
    <footer class="detail-foot"><p>${demo ? '가상 데이터 · 실제 이용 정보와 무관합니다.' : `출처: <a href="${esc(sourceUrl(state.manifest?.source?.url))}" target="_blank" rel="noopener noreferrer">한국환경공단 전기자동차 충전소 정보</a>`}</p>
      <p>시설 정보 갱신: ${formatTime(region?.inventoryUpdatedAt, true)}<br>표시 시각은 한국 시간입니다.</p>
      <p>충전 상태와 이용 조건은 현장과 다를 수 있습니다. 방문 전 운영사 안내를 확인하세요.</p><span class="detail-id">충전소 ID ${esc(station.id)}</span></footer>`;
  content.dataset.stationId = String(station.id);
  for (const detail of content.querySelectorAll('details[data-detail-section]')) {
    detail.open = openSections.has(detail.dataset.detailSection);
    if (dialog.open && detail.dataset.detailSection === focusedSection) detail.querySelector('summary')?.focus({preventScroll:true});
  }
  if (dialog.open) {
    if (focusedInput) $(focusedInput)?.focus({preventScroll:true});
    if (focusedAction || focusedHref) {
      const replacement = [...content.querySelectorAll('button[data-action], a[href]')].find(element => focusedAction ? element.dataset.action === focusedAction : element.getAttribute('href') === focusedHref);
      replacement?.focus({ preventScroll: true });
    }
    if (!sameStation) content.querySelector('[data-action="close"]')?.focus({preventScroll:true});
    dialog.scrollTop = sameStation ? scrollTop : 0;
  }
  updateCost();
  mobileFocus?.decorateDetail();
}

async function copyText(text, success = '복사했습니다.') {
  try { await navigator.clipboard.writeText(text); toast(success); }
  catch {
    const area = document.createElement('textarea'); area.value = text; area.setAttribute('aria-label', '복사할 내용'); area.style.cssText = 'position:fixed;left:12px;top:12px;width:1px;height:1px;opacity:.01;';
    ($('stationDialog').open ? $('stationDialog') : document.body).append(area); area.select();
    try { if (!document.execCommand('copy')) throw new Error('copy'); toast(success); } catch { toast('브라우저에서 복사하지 못했습니다. 주소 표시줄의 링크를 복사해 주세요.'); } finally { area.remove(); }
  }
}

async function shareStation(station) {
  const url = new URL(location.href); url.search = ''; url.hash = '';
  if (demo) url.searchParams.set('demo', '1');
  url.searchParams.set('station', station.id); url.searchParams.set('region', station.regionCode);
  if (state.filters.query) url.searchParams.set('q', state.filters.query);
  if (state.filters.connector) url.searchParams.set('connector', state.filters.connector);
  if (state.filters.minPower) url.searchParams.set('kw', state.filters.minPower);
  if (state.filters.speed) url.searchParams.set('speed', state.filters.speed);
  if (state.filters.operator) url.searchParams.set('operator', state.filters.operator);
  if (state.filters.open24) url.searchParams.set('open24', '1');
  if (state.filters.available) url.searchParams.set('available', '1');
  if (state.filters.unrestricted) url.searchParams.set('public', '1');
  if (state.filters.freeParking) url.searchParams.set('parking', '1');
  if (state.filters.sort !== 'available') url.searchParams.set('sort', state.filters.sort);
  const center = map?.getCenter() || station;
  if (hasCoordinates(center)) { url.searchParams.set('lat', center.lat.toFixed(6)); url.searchParams.set('lng', center.lng.toFixed(6)); url.searchParams.set('z', String(map?.getZoom?.() || center.zoom || 16)); }
  const data = { title: `${demo ? '[가상 예시] ' : ''}${station.name} · 충전한눈`, text: `${demo ? '화면 체험용 가상 충전소' : station.address}`, url: url.href };
  if (navigator.share) { try { await navigator.share(data); return; } catch (error) { if (error.name === 'AbortError') return; } }
  await copyText(url.href, '충전소 공유 링크를 복사했습니다.');
}

function setMobileView(view) {
  const mobile = window.matchMedia?.('(max-width:760px)').matches;
  if (mobile && mobileFocus) {
    $('appLayout').classList.add('mobile-map');
    $('mapTab').classList.toggle('active', view === 'map');
    $('listTab').classList.toggle('active', view === 'list');
    $('mapTab').setAttribute('aria-pressed', String(view === 'map'));
    $('listTab').setAttribute('aria-pressed', String(view === 'list'));
    if (view === 'list') mobileFocus.openList(false);
    else mobileFocus.enterBrowse();
    requestAnimationFrame(() => map?.resize());
    syncAds();
    return;
  }
  $('appLayout').classList.toggle('mobile-map', view === 'map');
  $('mapTab').classList.toggle('active', view === 'map'); $('listTab').classList.toggle('active', view !== 'map');
  $('mapTab').setAttribute('aria-pressed', String(view === 'map')); $('listTab').setAttribute('aria-pressed', String(view !== 'map'));
  if (view === 'map') requestAnimationFrame(() => map?.resize());
  syncAds();
}

async function initializeMap() {
  try {
    map = await createMap({ container: $('map'), config, onSelect: id => selectStation(String(id), { origin: 'map' }), onBoundsChange: mapBoundsChanged, onBackgroundClick: () => { if ($('stationDialog').open) closeDetails(); }, onError: error => { if (error?.recoverable) return; $('mapMessage').textContent = error?.message || '지도를 불러오지 못했습니다. 충전소 목록을 이용해 주세요.'; $('mapMessage').hidden = false; } });
    mobileFocus?.syncMapCapabilities();
    const selected = currentStation();
    if (selected && !preserveSelectedView && hasCoordinates(selected)) map.focus(selected, { zoom: 16 });
    else if (sharedView) map.setCenter(sharedView.center, sharedView.zoom);
    else if (demo) map.setCenter({ lat: 37.5658, lng: 126.979 }, 14);
    else if (initialLocation) map.locate(initialLocation);
    else if (!selected && !sharedView && !demo) map.setCenter(state.center, 14);
    // Some SDKs report the previous (Seoul) bounds while moving to a newly
    // acquired user position. Never use those bounds for the first data load.
    const requestedCenter = initialLocation || sharedView?.center || map.getCenter() || state.center;
    appliedBounds = initialVisibleBounds(requestedCenter, map.getBounds(), initialLocation ? 15 : map.getZoom());
    state.bounds = appliedBounds;
    state.center = requestedCenter;
    mapSearchPending = false;
    render();
  } catch (error) { $('mapMessage').textContent = '지도를 불러오지 못했습니다. 충전소 목록에서 정보를 확인할 수 있습니다.'; $('mapMessage').hidden = false; }
}

function bindEvents() {
  listScrollSelection = bindListScrollSelection($('listContent'),selectScrolledStation,{onIntent:()=>{selectionOrigin='scroll';cancelSelectedListReveal();bottomAd.setReading(true);}});
  $('searchForm').addEventListener('submit', event => { event.preventDefault(); clearTimeout(inputTimer); changeFilters({ query: $('searchInput').value }); });
  $('searchInput').addEventListener('input', event => { const query = event.target.value; state.filters.query = query; clearTimeout(inputTimer); inputTimer = setTimeout(() => changeFilters({ query }), 200); });
  $('clearSearch').addEventListener('click', () => { clearTimeout(inputTimer); changeFilters({ query: '' }); $('searchInput').focus(); });
  $('connectorSelect').addEventListener('change', event => changeFilters({ connector: event.target.value }));
  $('powerSelect').addEventListener('change', event => changeFilters({ minPower: Number(event.target.value) }));
  $('speedSelect').addEventListener('change', event => changeFilters({ speed: event.target.value }));
  $('operatorSelect').addEventListener('change', event => changeFilters({ operator: event.target.value }));
  $('open24Check').addEventListener('change', event => changeFilters({ open24: event.target.checked }));
  $('sortSelect').addEventListener('change', event => changeFilters({ sort: event.target.value }));
  $('freeParkingCheck').addEventListener('change', event => changeFilters({ freeParking: event.target.checked }));
  $('availableToggle').addEventListener('click', () => changeFilters({ available: !state.filters.available }));
  $('unrestrictedToggle').addEventListener('click', () => changeFilters({ unrestricted: !state.filters.unrestricted }));
  $('favoriteToggle').addEventListener('click', () => changeFilters({ favorites: !state.filters.favorites }));
  $('filtersToggle').addEventListener('click', () => {
    if (!$('filterDialog').open) $('filterDialog').showModal();
    syncAds();
    $('filtersToggle').setAttribute('aria-expanded', 'true');
  });
  $('closeFilters').addEventListener('click', () => $('filterDialog').close());
  $('filterDialog').addEventListener('close',syncAds);
  window.addEventListener('resize',syncAds,{passive:true});
  $('welcomeHelp').addEventListener('click',()=>welcomeAd.open());
  $('viewFilterResults').addEventListener('click', () => $('filterDialog').close());
  $('filterDialog').addEventListener('close', () => $('filtersToggle').setAttribute('aria-expanded', 'false'));
  $('filterDialog').addEventListener('click', event => {
    if (event.target !== $('filterDialog')) return;
    const rect = $('filterDialog').getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('filterDialog').close();
  });
  $('resetFilters').addEventListener('click', resetFilters);
  $('refreshButton').addEventListener('click', refresh);
  $('mapRefreshButton').addEventListener('click', refresh);
  $('searchThisArea').addEventListener('click', async () => {
    if (state.loading || !state.bounds) return;
    state.bounds = map?.getBounds?.() || state.bounds;
    await searchCurrentMap();
  });
  $('regionSelect').addEventListener('change', async event => {
    state.navigationRevision++;
    state.region = event.target.value; state.sharedId = null; state.listLimit = 60;
    automaticNational = false;
    cancelMapSearch();
    appliedBounds = null;
    if (state.region === 'auto') appliedBounds = state.bounds = map?.getBounds() || state.bounds;
    showRegionOnMap();
    await loadRegions();
  });
  $('listContent').addEventListener('click', event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const action = button.dataset.action;
    if (action === 'select') selectStation(button.dataset.id);
    else if (action === 'favorite') favorite(button.dataset.id);
    else if (action === 'reset') resetFilters();
    else if (action === 'refresh') refresh();
    else if (action === 'more') { state.listLimit += 60; render(); }
  });
  $('stationDialog').addEventListener('click', async event => {
    if (event.target === $('stationDialog')) { const rect = $('stationDialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDetails(); return; }
    const button = event.target.closest('[data-action]'); if (!button) return;
    if (button.dataset.action === 'close') { closeDetails(); return; }
    if (button.dataset.action === 'retry-detail') { await selectStation(state.selectedId); return; }
    if (button.dataset.action === 'refresh-status') { if (liveStatus.enabled) await refreshSelectedStatus(); else await refresh(); return; }
    if (button.dataset.action === 'nearby') {
      clearTimeout(inputTimer);
      state.filters = {...state.filters,query:'',favorites:false};
      state.listLimit = 60;
      const target = allStations().find(item => String(item.id) === button.dataset.id);
      if (state.region === 'auto' && target && hasCoordinates(target)) {
        appliedBounds = initialVisibleBounds(target, null, Math.max(16, map?.getZoom?.() || 16));
        state.bounds = appliedBounds;
        state.center = {lat:target.lat,lng:target.lng};
        mapSearchPending = false;
        updateMapSearchButton();
      }
      selectStation(button.dataset.id);
      $('stationDialog').scrollTop = 0;
      return;
    }
    const station = currentStation(); if (!station) return;
    if (button.dataset.action === 'detail-favorite') favorite(station.id);
    else if (button.dataset.action === 'copy-address') await copyText(station.address, '주소를 복사했습니다.');
    else if (button.dataset.action === 'share') await shareStation(station);
    else if (button.dataset.action === 'demo-navigation') toast('실제 방문 장소가 없는 가상 예시입니다.');
    else if (button.dataset.action === 'missing-location') toast('위치 좌표를 확인할 수 없는 충전소입니다.');
  });
  $('stationDialog').addEventListener('input', event => {if (['costEnergy','costPrice'].includes(event.target.id)) updateCost();});
  $('stationDialog').addEventListener('cancel', event => { event.preventDefault(); closeDetails(); });
  $('mapTab').addEventListener('click', () => setMobileView('map'));
  $('listTab').addEventListener('click', () => setMobileView('list'));
  $('locateButton').addEventListener('click', async () => {
    const revision = ++state.navigationRevision;
    cancelMapSearch();
    $('locateButton').disabled = true;
    try {
      const point = await requestLocation();
      if (revision !== state.navigationRevision) return;
      state.center = point;
      state.region = 'auto';
      automaticNational = false;
      $('regionSelect').value = 'auto';
      map?.locate(point);
      appliedBounds = initialVisibleBounds(point, map?.getBounds(), map?.getZoom());
      state.bounds = appliedBounds;
      state.listLimit = 60;
      mapSearchPending = false;
      locationFailure = '';
      await loadRegions();
      toast('내 위치 주변 충전소를 조회했습니다.');
    } catch (error) {
      if (revision === state.navigationRevision) toast(error.message);
    } finally { $('locateButton').disabled = false; updateMapSearchButton(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !demo) { void refreshSelectedStatus(); refresh(); } });
  window.addEventListener('storage', event => { if (event.key === favoriteKey) { state.favorites = readFavorites(); render(); } });
}

bindEvents();
setMode();
// On mobile the default list tab hides the SDK canvas (zero geometry).
// Show the map before creating it, as in the care-map mobile flow.
if (window.matchMedia?.('(max-width:760px)').matches) setMobileView('map');
await initialGeolocation();
await initializeMap();
await refresh();
if (state.filters.query.trim() && window.matchMedia?.('(max-width:760px)').matches) setMobileView('list');
function startPolling() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if (document.hidden) return; if (!demo) { void refreshSelectedStatus(); refresh(); } else { render(); const station = currentStation(); if (station && $('stationDialog').open) renderDetails(station); } }, 60000);
}
startPolling();
welcomeAd.start();
window.addEventListener('pagehide', event => { clearInterval(refreshTimer); clearTimeout(boundsTimer); clearTimeout(inputTimer); cancelAnimationFrame(selectedListFrame); if(event.persisted)listScrollSelection?.suppress();else {listScrollSelection?.destroy();mobileFocus?.destroy();bottomAd.destroy();adManager.destroy();} });
window.addEventListener('pageshow', event => { if (event.persisted) { startPolling(); if (!demo) refresh(); } });
