import { createMap, parseSharedView } from './map.js';
import { DataClient, selectViewportRegions, filterStationsToBounds, sameMapBounds } from './data.js';
import { getBrowserLocation, locationMessage } from './location.js';
import { DEFAULT_FILTERS, chargerState, summarizeStation, filterStations, typeInfo, distanceKm, hasCoordinates, safePhone, sourceUrl } from './domain.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const params = new URLSearchParams(location.search);
const sharedView = parseSharedView(params);
const config = window.EV_CONFIG || {};
const client = new DataClient(config);
const demo = params.get('demo') === '1';
const favoriteKey = demo ? 'evchargingstation:demo-favorites:v1' : 'evchargingstation:favorites:v1';
const sharedFilters = { query: (params.get('q') || '').slice(0, 200), connector: ['combo', 'ac', 'nacs', 'chademo', 'ac3', 'combo2'].includes(params.get('connector')) ? params.get('connector') : '', minPower: [50, 100, 200, 300].includes(Number(params.get('kw'))) ? Number(params.get('kw')) : 0, available: params.get('available') === '1', unrestricted: params.get('public') === '1', freeParking: params.get('parking') === '1', sort: ['available', 'distance', 'name'].includes(params.get('sort')) ? params.get('sort') : 'available' };
const state = { manifest: null, regions: new Map(), activeCodes: [], filters: { ...DEFAULT_FILTERS, ...sharedFilters }, favorites: readFavorites(), region: params.get('region') || 'auto', bounds: null, locationPoint: null, selectedId: null, listLimit: 60, loading: false, error: '', partialError: '', visible: [], summaries: new Map(), center: sharedView?.center || { lat: 37.5665, lng: 126.978 }, demo, sharedId: params.get('station'), loadEpoch: 0, navigationRevision: 0 };
let map = null;
let preserveSelectedView = false;
let toastTimer;
let boundsTimer;
let inputTimer;
let refreshTimer;
let demoRegion;
let initialRegionCentered = false;
let mapSearchPending = false;

function updateMapSearchButton() {
  const button = $('searchThisArea');
  if (!button) return;
  button.hidden = !mapSearchPending;
  button.disabled = state.loading;
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
const stationRegion = station => state.regions.get(String(station.regionCode));
const allStations = () => state.activeCodes.flatMap(code => state.regions.get(code)?.stations || []);
const currentStation = () => allStations().find(station => String(station.id) === state.selectedId);

function updateControls() {
  $('availableToggle').setAttribute('aria-pressed', String(state.filters.available));
  $('unrestrictedToggle').setAttribute('aria-pressed', String(state.filters.unrestricted));
  $('favoriteToggle').setAttribute('aria-pressed', String(state.filters.favorites));
  $('favoriteCount').textContent = state.favorites.size.toLocaleString('ko-KR');
  $('connectorSelect').value = state.filters.connector;
  $('powerSelect').value = String(state.filters.minPower);
  $('freeParkingCheck').checked = state.filters.freeParking;
  $('sortSelect').value = state.filters.sort;
  $('searchInput').value = state.filters.query;
  $('clearSearch').hidden = !state.filters.query;
  const count = Number(Boolean(state.filters.minPower)) + Number(state.filters.freeParking);
  $('extraFilterCount').textContent = count;
  $('extraFilterCount').hidden = !count;
  $('refreshButton').disabled = state.loading;
  $('refreshButton').classList.toggle('refreshing', state.loading);
}

function setMode() {
  const mode = demo ? 'demo' : state.manifest?.mode || 'unconfigured';
  const labels = { demo: '예시 데이터', live: '상태 자동 갱신', snapshot: '수집 시점 데이터', unconfigured: '데이터 연결 준비' };
  $('modeBadge').className = `mode-badge ${mode}`;
  $('modeBadge').innerHTML = `<span class="status-dot"></span>${esc(labels[mode] || '데이터 확인 필요')}`;
  $('demoBanner').hidden = !demo;
  document.body.classList.toggle('is-demo', demo);
  $('inventoryTime').textContent = `시설 정보 갱신 시각: ${formatTime(state.manifest?.inventoryUpdatedAt, true)} (한국 시간)`;
}

function scopeLabel() {
  const names = (state.manifest?.regions || []).filter(entry => state.activeCodes.includes(String(entry.code))).map(entry => entry.name);
  if (demo) return '서울 · 화면 체험용 가상 충전소';
  if (!names.length) return state.manifest?.mode === 'unconfigured' ? '실제 데이터 연결 후 검색할 수 있습니다' : '선택한 지역 안에서 검색합니다';
  return `${names.join(' · ')} · 현재 지도 화면 기준${state.filters.favorites ? ' · 저장한 충전소' : ''}`;
}

function emptyHTML() {
  if (state.error && !allStations().length) return `<div class="empty-state"><div class="empty-icon">${icon('refresh')}</div><h3>정보를 불러오지 못했습니다</h3><p>연결 상태를 확인한 후 다시 시도해 주세요.</p><div class="empty-actions"><button class="button primary" data-action="refresh">${icon('refresh')}다시 불러오기</button><a class="button" href="https://www.data.go.kr/data/15076352/openapi.do" target="_blank" rel="noopener noreferrer">데이터 출처</a></div><p class="fine-print">${esc(state.error)}</p></div>`;
  if (!demo && state.manifest?.mode === 'unconfigured') return `<div class="empty-state"><div class="empty-icon">${icon('bolt')}</div><h3>충전소 데이터를 준비하고 있습니다</h3><p>공공데이터 연결이 완료되면<br>충전소 위치와 충전 상태를 확인할 수 있습니다.</p><div class="empty-actions"><button class="button primary" data-action="refresh">${icon('refresh')}새로고침</button><a class="button" href="?demo=1">화면 체험${icon('arrow')}</a></div><p class="fine-print">화면 체험은 별도로 표시된 가상 데이터로 제공됩니다.</p></div>`;
  if (!demo && !allStations().length && state.manifest?.warnings?.some(item => item.code === 'INITIALIZING')) return `<div class="empty-state"><div class="empty-icon">${icon('refresh')}</div><h3>충전소 정보를 수집하고 있습니다</h3><p>확인이 완료되면 충전소가 자동으로 표시됩니다.<br>잠시 후 다시 확인해 주세요.</p><button class="button" data-action="refresh">${icon('refresh')}새로고침</button></div>`;
  if (state.loading) return `<div class="loading-state"><span class="loader"></span><p>충전소 정보를 불러오고 있습니다</p></div>`;
  if (!state.activeCodes.length) return `<div class="empty-state"><div class="empty-icon">${icon('pin')}</div><h3>조회할 지역을 선택해 주세요</h3><p>지역을 선택하거나 지도를 움직이면 해당 지역의 충전소를 확인할 수 있습니다.</p></div>`;
  return `<div class="empty-state"><div class="empty-icon">${icon(state.filters.favorites ? 'bookmark' : 'search')}</div><h3>${state.filters.favorites ? '이 지역에 저장한 충전소가 없습니다' : '조건에 맞는 충전소가 없습니다'}</h3><p>${state.filters.available ? '충전 대기는 최근 확인된 충전기에만 표시됩니다. 조건을 조정하거나 다른 지역을 확인해 보세요.' : '검색어와 지역, 커넥터 조건을 조정해 보세요.'}</p><button class="button" data-action="reset">검색 조건 초기화</button></div>`;
}

function stationCard(station, index) {
  const summary = state.summaries.get(station.id);
  const region = stationRegion(station);
  const checks = (station.chargers || []).map(charger => chargerState(charger, region, Date.now(), threshold()));
  const confirmed = checks.map(check => check.confirmedAt).filter(value => value !== null);
  const mostRecent = confirmed.length ? Math.max(...confirmed) : null;
  const dist = distanceKm(state.center, station);
  const connectorNames = [...new Set((station.chargers || []).map(charger => typeInfo(charger.type).name))];
  const connectors = connectorNames.length > 2 ? `${connectorNames.slice(0, 2).join(' · ')} 외` : connectorNames.join(' · ');
  const availability = summary.available > 0 ? `<b>${summary.available}</b>기 충전 대기 <small>/ ${summary.matching}기${summary.matching !== summary.total ? ' 조건 일치' : ''}</small>` : summary.unknown ? '현재 상태 확인 필요' : '충전 대기 없음';
  return `<article class="station-card${state.selectedId === station.id ? ' selected' : ''}" data-station-id="${esc(station.id)}" data-tone="${summary.tone}"><span class="station-number" aria-hidden="true">${index + 1}</span><div class="station-main"><button type="button" class="station-name" data-action="select" data-id="${esc(station.id)}">${esc(station.name)}</button><p class="station-address">${esc(station.address || '주소 미확인')}</p><div class="card-status-row"><span class="availability ${summary.tone}">${availability}</span><span class="card-distance">${Number.isFinite(dist) ? `${dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`}` : '위치 미확인'}</span></div><div class="card-tags">${summary.maxPower ? `<span class="power-tag">최대 ${esc(summary.maxPower)} kW</span>` : ''}<span>${esc(connectors || '커넥터 미확인')}</span>${station.restricted === true ? '<span class="warning-tag">이용 제한</span>' : ''}${station.parkingFree === true ? '<span>주차 무료 등록</span>' : ''}${summary.hasBusOnly ? '<span class="warning-tag">버스 전용 포함</span>' : ''}</div><p class="card-update">${demo ? '가상 예시 · ' : ''}${relativeTime(mostRecent)}${summary.stale && confirmed.length ? ' · 일부 충전기 확인 지연' : ''}</p></div><button type="button" class="card-save" data-action="favorite" data-id="${esc(station.id)}" aria-label="${esc(station.name)} ${state.favorites.has(station.id) ? '저장 해제' : '저장'}" aria-pressed="${state.favorites.has(station.id)}">${icon('bookmark')}</button></article>`;
}

function render() {
  // A region shard can span tens of thousands of places; lists, counts and
  // markers must all use only the visible map viewport.
  const stations = filterStationsToBounds(allStations(), state.bounds);
  const now = Date.now();
  state.summaries = new Map(stations.map(station => [station.id, summarizeStation(station, stationRegion(station), state.filters, now, threshold())]));
  state.visible = filterStations(stations, state.regions, state.filters, state.favorites, now, threshold());
  state.visible.sort((a, b) => {
    if (state.filters.sort === 'name') return a.name.localeCompare(b.name, 'ko');
    if (state.filters.sort === 'available') {
      const delta = state.summaries.get(b.id).available - state.summaries.get(a.id).available;
      if (delta) return delta;
    }
    return distanceKm(state.center, a) - distanceKm(state.center, b) || a.name.localeCompare(b.name, 'ko');
  });
  $('resultCount').textContent = state.manifest ? state.visible.length.toLocaleString('ko-KR') : '—';
  $('scopeLabel').textContent = scopeLabel();
  const shown = state.visible.slice(0, state.listLimit);
  $('listContent').innerHTML = shown.length ? shown.map(stationCard).join('') + (state.visible.length > shown.length ? `<button type="button" class="button show-more" data-action="more">충전소 더 보기 (${shown.length.toLocaleString('ko-KR')} / ${state.visible.length.toLocaleString('ko-KR')})</button>` : '') : emptyHTML();
  const warningCodes = new Set((state.manifest?.warnings || []).map(item => item.code));
  const knownWarnings = new Set(['NOT_CONFIGURED', 'UNCONFIGURED', 'INITIALIZING', 'INVALID_COORDINATES']);
  const collectionFailed = [...warningCodes].some(code => !knownWarnings.has(code));
  const warnings = [warningCodes.has('INITIALIZING') && stations.length ? '최신 충전소 정보를 수집하고 있습니다.' : '', warningCodes.has('INVALID_COORDINATES') ? '위치 정보가 없는 충전소는 목록에서 확인할 수 있습니다.' : '', collectionFailed ? '데이터 갱신이 지연되고 있습니다. 마지막으로 확인된 정보와 확인 시각을 확인해 주세요.' : ''].filter(Boolean);
  const areaNeedsLoad = mapSearchPending && (state.region !== 'auto' || regionEntries().some(entry => !state.activeCodes.includes(String(entry.code))));
  const issue = [areaNeedsLoad ? '이 화면의 일부 지역 데이터는 아직 조회하지 않았습니다. 지도 위 이 지역 검색을 누르세요.' : '', state.partialError, state.error && stations.length ? `${state.error} 마지막으로 확인한 정보를 표시합니다.` : '', ...warnings].filter(Boolean).join(' ');
  $('resultNotice').textContent = issue;
  $('resultNotice').hidden = !issue;
  const waiting = state.visible.reduce((sum, station) => sum + state.summaries.get(station.id).available, 0);
  $('mapSummary').innerHTML = `${icon('pin')}<span>${state.visible.length ? `${demo ? '가상 예시 · ' : ''}화면 안 충전소 <b>${state.visible.length.toLocaleString('ko-KR')}</b>곳 <span aria-hidden="true">·</span> 충전 대기 <b>${waiting.toLocaleString('ko-KR')}</b>기` : state.manifest?.mode === 'unconfigured' ? '충전소 데이터 연결을 준비하고 있습니다' : '지도를 움직여 주변을 탐색하세요'}</span>`;
  $('mapEmpty').hidden = true;
  const freshest = [...state.regions.values()].filter(region => state.activeCodes.includes(String(region.regionCode))).map(region => region.statusCoverageAt || region.generatedAt).filter(Boolean).sort().at(-1);
  $('freshnessLine').querySelector('span').textContent = demo ? '가상 예시 · 실제 충전 상태가 아닙니다' : state.manifest?.mode === 'unconfigured' ? '연결 후 충전기별 확인 시각을 표시합니다' : freshest ? `지역 데이터 ${relativeTime(freshest)} · 상태는 충전기별 확인` : '충전 상태 확인 시각을 함께 표시합니다';
  updateControls();
  updateMapSearchButton();
  setMode();
  map?.setStations(state.visible, { selectedId: state.selectedId, summaries: state.summaries });
}

function fillRegions() {
  $('regionSelect').innerHTML = '<option value="auto">지도 주변</option>' + (state.manifest?.regions || []).map(region => `<option value="${esc(region.code)}">${esc(region.name)}</option>`).join('');
  if (state.region !== 'auto' && !(state.manifest?.regions || []).some(region => String(region.code) === state.region)) state.region = 'auto';
  $('regionSelect').value = state.region;
}

function regionEntries() {
  const entries = state.manifest?.regions || [];
  if (state.region !== 'auto') return entries.filter(region => String(region.code) === state.region);
  const bounds = state.bounds || { south: state.center.lat - .05, north: state.center.lat + .05, west: state.center.lng - .08, east: state.center.lng + .08 };
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
  const entries = regionEntries();
  const codes = entries.map(region => String(region.code));
  if (!force && codes.join(',') === state.activeCodes.join(',') && codes.every(code => state.regions.has(code))) { render(); return; }
  const epoch = ++state.loadEpoch;
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
  if (entries.length >= 4 && state.region === 'auto') state.partialError = [state.partialError, '지도 중심에 가까운 최대 4개 지역을 조회합니다. 지도를 확대하거나 지역을 선택해 더 자세히 검색하세요.'].filter(Boolean).join(' ');
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

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  state.error = '';
  render();
  try {
    if (demo) { const { createDemo } = await import('./demo.js'); const data = createDemo(); state.manifest = data.manifest; demoRegion = data.region; }
    else { state.manifest = await client.manifest(); if (state.manifest.mode === 'demo') throw new Error('실제 데이터 연결을 확인해 주세요.'); }
    fillRegions();
    await loadRegions(true);
  } catch (error) { state.error = error.message || '네트워크 연결을 확인해 주세요.'; state.loading = false; render(); }
}

function resetFilters() {
  clearTimeout(inputTimer);
  state.filters = { ...DEFAULT_FILTERS };
  state.listLimit = 60;
  render();
}

function changeFilters(patch) {
  state.filters = { ...state.filters, ...patch };
  state.listLimit = 60;
  render();
  $('listContent').scrollTop = 0;
}

function favorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
  writeFavorites();
  render();
  const station = currentStation();
  if (station && $('stationDialog').open) renderDetails(station);
}

function selectStation(id, { preserveView = false, origin = 'list' } = {}) {
  const station = allStations().find(item => item.id === id);
  if (!station) return;
  state.navigationRevision++;
  state.selectedId = id;
  preserveSelectedView = preserveView;
  const index = state.visible.findIndex(item => String(item.id) === String(id));
  if (origin === 'map' && index >= state.listLimit) state.listLimit = Math.ceil((index + 1) / 60) * 60;
  render();
  if (origin === 'map') {
    requestAnimationFrame(() => {
      const card = [...$('listContent').querySelectorAll('.station-card')].find(node => node.dataset.stationId === String(id));
      card?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    });
  }
  if (hasCoordinates(station) && !preserveView) map?.focus(station, { zoom: Math.max(16, map?.getZoom?.() || 16) });
  renderDetails(station);
  // Nonmodal panel preserves an interactive, unblurred map and list.
  if (!$('stationDialog').open) $('stationDialog').show();
}

function closeDetails() {
  $('stationDialog').close();
  document.body.append($('toast'));
  state.selectedId = null;
  preserveSelectedView = false;
  map?.setStations(state.visible, { selectedId: null, summaries: state.summaries });
  document.querySelector('.station-card.selected')?.classList.remove('selected');
}

function renderDetails(station) {
  const dialog = $('stationDialog');
  const content = $('detailContent');
  const focused = content.contains(document.activeElement) ? document.activeElement : null;
  const focusedAction = focused?.dataset.action;
  const focusedHref = focused?.getAttribute('href');
  const scrollTop = dialog.scrollTop;
  const region = stationRegion(station);
  const summary = summarizeStation(station, region, DEFAULT_FILTERS, Date.now(), threshold());
  const phone = safePhone(station.phone);
  const restricted = station.restricted === true ? `이용 제한 있음${station.restrictionReason ? ` · ${station.restrictionReason}` : ''}` : station.restricted === false ? '이용 제한 없음으로 등록' : '이용 제한 여부 미확인';
  const parking = station.parkingFree === true ? '주차 무료로 등록' : station.parkingFree === false ? '주차 유료로 등록' : '주차 요금 미확인';
  const nav = hasCoordinates(station) && !demo;
  const naver = !demo ? `https://map.naver.com/p/search/${encodeURIComponent(station.address || station.name)}` : '';
  const kakao = nav ? `https://map.kakao.com/link/to/${encodeURIComponent(station.name)},${station.lat},${station.lng}` : '';
  const rows = (station.chargers || []).map(charger => {
    const check = chargerState(charger, region, Date.now(), threshold());
    return `<div class="charger-row"><div class="charger-name">${esc(charger.id)}번 충전기 · ${esc(typeInfo(charger.type).name)}</div><span class="charger-status ${check.available ? 'available' : !check.fresh ? 'unknown' : ''}">${esc(check.label)}</span><div class="charger-meta">${Number.isFinite(charger.outputKw) ? `${esc(charger.outputKw)} kW` : '출력 미확인'}${charger.method ? ` · ${esc(charger.method)}` : ''}</div><div class="charger-times">상태 확인: <strong>${check.confirmedAt !== null ? formatTime(check.confirmedAt, true) : '확인 시각 없음'}</strong>${!check.fresh ? ` · 마지막 보고 ${esc(check.sourceLabel)}` : ''}<br>상태 변경: ${formatTime(charger.statusChangedAt, true)}${check.futureTimestamp ? '<br>일부 확인 시각이 현재보다 앞서 있어 신선도 판정에서 제외했습니다.' : ''}</div></div>`;
  }).join('');
  $('detailContent').innerHTML = `<div class="detail-top"><p class="detail-eyebrow">${demo ? 'DEMO · 가상 충전소' : 'CHARGING STATION'}</p><button class="icon-button close-detail" type="button" data-action="close" aria-label="충전소 상세 닫기">${icon('close')}</button><h2 id="detailTitle">${esc(station.name)}</h2><p class="detail-address">${esc(station.address || '주소 미확인')}${station.address ? `<button class="icon-button" type="button" data-action="copy-address" aria-label="주소 복사">${icon('copy')}</button>` : ''}${station.detailAddress ? `<br>${esc(station.detailAddress)}` : ''}</p><div class="detail-actions">${nav ? `<a class="button primary" href="${esc(naver)}" target="_blank" rel="noopener noreferrer">${icon('nav')}네이버 지도</a><a class="button" href="${esc(kakao)}" target="_blank" rel="noopener noreferrer">카카오 길찾기</a>` : `<button class="button" type="button" data-action="${demo ? 'demo-navigation' : 'missing-location'}">${icon('nav')}${demo ? '예시 위치' : '위치 미확인'}</button>`}<button class="button icon-only" type="button" data-action="detail-favorite" aria-label="${state.favorites.has(station.id) ? '저장 해제' : '충전소 저장'}" aria-pressed="${state.favorites.has(station.id)}">${icon('bookmark')}</button><button class="button icon-only" type="button" data-action="share" aria-label="충전소 공유">${icon('share')}</button></div></div>${demo ? '<div class="detail-demo"><strong>화면 체험용 가상 정보입니다.</strong><br>실제 충전소나 이용 가능한 충전 상태를 나타내지 않습니다.</div>' : ''}<section class="detail-section"><h3>충전기 현황</h3><div class="detail-stat"><div><span class="big-number">${summary.available}<small> / ${summary.total}기</small></span><p>${demo ? '예시 기준' : '최근 확인 기준'} 충전 대기</p></div>${icon('bolt')}</div><p class="detail-freshness">${Math.round(threshold() / 60)}분 이내 상태가 확인된 충전기만 충전 대기로 표시합니다.<br>커넥터 여러 개를 제공하는 충전기는 한 기로 계산합니다.${summary.stale ? `<br><strong>${summary.stale}기는 현재 상태를 다시 확인해야 합니다.</strong>` : ''}</p>${rows || '<p class="detail-freshness">등록된 충전기 정보가 없습니다.</p>'}</section><section class="detail-section"><h3>이용 안내</h3><dl class="detail-info"><dt>이용 시간</dt><dd>${esc(station.useTime || '운영 시간 미확인')}</dd><dt>설치 위치</dt><dd>${esc(station.location || '세부 위치 미확인')}</dd><dt>이용 제한</dt><dd${station.restricted !== false ? ' class="warning"' : ''}>${esc(restricted)}</dd><dt>주차</dt><dd>${esc(parking)}</dd><dt>충전 요금</dt><dd>운영사 요금 확인 필요</dd><dt>운영사</dt><dd>${esc(station.operatorName || '운영사 미확인')}</dd><dt>문의</dt><dd>${phone && !demo ? `<a href="tel:${esc(phone)}">${icon('phone')} ${esc(station.phone)}</a>` : '연락처 미확인'}</dd>${station.note ? `<dt>참고 사항</dt><dd>${esc(station.note)}</dd>` : ''}</dl></section><footer class="detail-foot"><p>${demo ? '가상 데이터 · 실제 이용 정보와 무관합니다.' : `출처: <a href="${esc(sourceUrl(state.manifest?.source?.url))}" target="_blank" rel="noopener noreferrer">한국환경공단 전기자동차 충전소 정보</a>`}</p><p>시설 정보 갱신: ${formatTime(region?.inventoryUpdatedAt, true)}<br>표시 시각은 한국 시간입니다.</p><p>대기 상태는 방문 시 달라질 수 있습니다. 이용 제한, 주차 요금과 충전 요금은 운영사 안내를 확인하세요.</p><span class="detail-id">충전소 ID ${esc(station.id)}</span></footer>`;
  if (dialog.open) {
    if (focusedAction || focusedHref) {
      const replacement = [...content.querySelectorAll('button[data-action], a[href]')].find(element => focusedAction ? element.dataset.action === focusedAction : element.getAttribute('href') === focusedHref);
      replacement?.focus({ preventScroll: true });
    }
    dialog.scrollTop = scrollTop;
  }
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
  $('appLayout').classList.toggle('mobile-map', view === 'map');
  $('mapTab').classList.toggle('active', view === 'map'); $('listTab').classList.toggle('active', view !== 'map');
  $('mapTab').setAttribute('aria-pressed', String(view === 'map')); $('listTab').setAttribute('aria-pressed', String(view !== 'map'));
  if (view === 'map') requestAnimationFrame(() => map?.resize());
}

async function initializeMap() {
  try {
    map = await createMap({ container: $('map'), config, onSelect: id => selectStation(String(id), { origin: 'map' }), onBoundsChange: bounds => {
      state.navigationRevision++;
      state.bounds = bounds;
      state.center = map?.getCenter() || { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
      // Do not change the loaded region/list while the user is panning.
      // The explicit overlay button applies the new viewport on demand.
      clearTimeout(boundsTimer);
      mapSearchPending = true;
      updateMapSearchButton();
    }, onBackgroundClick: () => { if ($('stationDialog').open) closeDetails(); }, onError: error => { if (error?.recoverable) return; $('mapMessage').textContent = error?.message || '지도를 불러오지 못했습니다. 충전소 목록을 이용해 주세요.'; $('mapMessage').hidden = false; } });
    const selected = currentStation();
    if (selected && !preserveSelectedView && hasCoordinates(selected)) map.focus(selected, { zoom: 16 });
    else if (sharedView) map.setCenter(sharedView.center, sharedView.zoom);
    else if (demo) map.setCenter({ lat: 37.5658, lng: 126.979 }, 14);
    render();
  } catch (error) { $('mapMessage').textContent = '지도를 불러오지 못했습니다. 충전소 목록에서 정보를 확인할 수 있습니다.'; $('mapMessage').hidden = false; }
}

function bindEvents() {
  $('searchForm').addEventListener('submit', event => { event.preventDefault(); clearTimeout(inputTimer); changeFilters({ query: $('searchInput').value }); });
  $('searchInput').addEventListener('input', event => { const query = event.target.value; state.filters.query = query; clearTimeout(inputTimer); inputTimer = setTimeout(() => changeFilters({ query }), 200); });
  $('clearSearch').addEventListener('click', () => { clearTimeout(inputTimer); changeFilters({ query: '' }); $('searchInput').focus(); });
  $('connectorSelect').addEventListener('change', event => changeFilters({ connector: event.target.value }));
  $('powerSelect').addEventListener('change', event => changeFilters({ minPower: Number(event.target.value) }));
  $('sortSelect').addEventListener('change', event => changeFilters({ sort: event.target.value }));
  $('freeParkingCheck').addEventListener('change', event => changeFilters({ freeParking: event.target.checked }));
  $('availableToggle').addEventListener('click', () => changeFilters({ available: !state.filters.available }));
  $('unrestrictedToggle').addEventListener('click', () => changeFilters({ unrestricted: !state.filters.unrestricted }));
  $('favoriteToggle').addEventListener('click', () => changeFilters({ favorites: !state.filters.favorites }));
  $('filtersToggle').addEventListener('click', () => { const open = $('extraFilters').hidden; $('extraFilters').hidden = !open; $('filtersToggle').setAttribute('aria-expanded', String(open)); requestAnimationFrame(() => map?.resize()); });
  $('resetFilters').addEventListener('click', resetFilters);
  $('refreshButton').addEventListener('click', refresh);
  $('searchThisArea').addEventListener('click', async () => {
    if (state.loading || !state.bounds) return;
    clearTimeout(boundsTimer);
    mapSearchPending = false;
    state.region = 'auto';
    $('regionSelect').value = 'auto';
    state.sharedId = null;
    state.listLimit = 60;
    updateMapSearchButton();
    await loadRegions();
    $('listContent').scrollTop = 0;
  });
  $('regionSelect').addEventListener('change', async event => {
    state.navigationRevision++;
    state.region = event.target.value; state.sharedId = null; state.listLimit = 60;
    mapSearchPending = false;
    updateMapSearchButton();
    const entry = state.manifest?.regions.find(region => String(region.code) === state.region);
    if (entry?.bounds) { const bounds = entry.bounds; state.center = { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 }; map?.setCenter(state.center, 10); }
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
    const station = currentStation(); if (!station) return;
    if (button.dataset.action === 'detail-favorite') favorite(station.id);
    else if (button.dataset.action === 'copy-address') await copyText(station.address, '주소를 복사했습니다.');
    else if (button.dataset.action === 'share') await shareStation(station);
    else if (button.dataset.action === 'demo-navigation') toast('실제 방문 장소가 없는 가상 예시입니다.');
    else if (button.dataset.action === 'missing-location') toast('위치 좌표를 확인할 수 없는 충전소입니다.');
  });
  $('stationDialog').addEventListener('cancel', event => { event.preventDefault(); closeDetails(); });
  $('mapTab').addEventListener('click', () => setMobileView('map'));
  $('listTab').addEventListener('click', () => setMobileView('list'));
  $('locateButton').addEventListener('click', () => {
    if (!navigator.geolocation) { toast('이 브라우저에서는 위치 확인을 지원하지 않습니다.'); return; }
    $('locateButton').disabled = true;
    const requestedRevision = ++state.navigationRevision;
    navigator.geolocation.getCurrentPosition(position => {
      $('locateButton').disabled = false;
      if (requestedRevision !== state.navigationRevision) return;
      state.center = { lat: position.coords.latitude, lng: position.coords.longitude };
      state.region = 'auto'; $('regionSelect').value = 'auto'; map?.locate(state.center);
      mapSearchPending = true;
      updateMapSearchButton();
      if (!map) { state.bounds = null; loadRegions(); }
      toast('내 위치 주변의 충전소를 조회합니다.');
    }, error => { $('locateButton').disabled = false; if (requestedRevision !== state.navigationRevision) return; toast(error.code === 1 ? '위치 권한을 허용하거나 지역을 직접 선택해 주세요.' : '현재 위치를 확인하지 못했습니다. 지역을 직접 선택해 주세요.'); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !demo) refresh(); });
  window.addEventListener('storage', event => { if (event.key === favoriteKey) { state.favorites = readFavorites(); render(); } });
}

bindEvents();
setMode();
await Promise.allSettled([initializeMap(), refresh()]);
function startPolling() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if (document.hidden) return; if (!demo) refresh(); else { render(); const station = currentStation(); if (station && $('stationDialog').open) renderDetails(station); } }, 60000);
}
startPolling();
window.addEventListener('pagehide', () => { clearInterval(refreshTimer); clearTimeout(boundsTimer); clearTimeout(inputTimer); });
window.addEventListener('pageshow', event => { if (event.persisted) { startPolling(); if (!demo) refresh(); } });
