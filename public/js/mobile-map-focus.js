// Mobile map focus controller shared with the charging-station UX.
// Keeps one map instance alive while switching between browse/detail/list sheet states.

export const MAP_FOCUS_STATES = Object.freeze([
  'map-browse','map-collapsed','focus-detail','expanded-tools','list-sheet','list-sheet-expanded'
]);

export function resolveSheetGesture(state, deltaY) {
  if (!Number.isFinite(deltaY)) return state;
  if (state === 'focus-detail') return deltaY < -56 ? 'expanded-tools' : deltaY > 92 ? 'map-browse' : state;
  if (state === 'expanded-tools') return deltaY > 56 ? 'focus-detail' : state;
  if (state === 'list-sheet') return deltaY < -56 ? 'list-sheet-expanded' : deltaY > 92 ? 'map-browse' : state;
  if (state === 'list-sheet-expanded') return deltaY > 56 ? 'list-sheet' : state;
  return state;
}

const detailState = state => state === 'focus-detail' || state === 'expanded-tools';
const listState = state => state === 'list-sheet' || state === 'list-sheet-expanded';

function mapIcon(path) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
}

export function createMobileMapFocus({
  root,
  dialog,
  results,
  resultCount,
  favoriteCount,
  onResize = () => {},
  onRefocus = () => {},
  onMapTypeState = () => ({ supported: false, type: 'normal' }),
  onToggleMapType = () => false,
  onFavorites = () => {},
  onCloseDetail = () => {}
} = {}) {
  if (!root || !dialog || !results) return null;
  const media = window.matchMedia('(max-width:760px)');
  let state = media.matches ? 'map-browse' : 'default';
  let lastMapState = 'map-browse';
  let historyOverlay = false;
  let drag = null;
  const cleanups = [];

  const advanced = document.createElement('div');
  advanced.className = 'map-focus-advanced';
  advanced.dataset.mapObstacle = '';
  advanced.innerHTML = `
    <button type="button" data-focus-action="map-type" aria-label="지도 유형 전환" title="지도 유형 전환">
      ${mapIcon('M4 6.5 9 4l6 2.5L20 4v13.5L15 20l-6-2.5L4 20V6.5Zm5-1v11l6 2v-11l-6-2Z')}
      <span>지도</span>
    </button>
    <button type="button" data-focus-action="collapse" aria-label="지도만 크게 보기" title="지도만 크게 보기">
      ${mapIcon('M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5')}
      <span>지도만</span>
    </button>`;

  const expandFab = document.createElement('button');
  expandFab.type = 'button';
  expandFab.className = 'map-focus-expand-fab';
  expandFab.dataset.focusAction = 'expand';
  expandFab.setAttribute('aria-label','지도 검색 도구 펼치기');
  expandFab.innerHTML = `${mapIcon('M4 7h16M4 12h16M4 17h16')}<span>도구</span>`;

  const dock = document.createElement('nav');
  dock.className = 'map-focus-dock';
  dock.dataset.mapObstacle = '';
  dock.setAttribute('aria-label','지도 빠른 메뉴');
  dock.innerHTML = `
    <button type="button" data-focus-action="list">
      ${mapIcon('M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1')}
      <span>목록 <b data-focus-count="results">0</b></span>
    </button>
    <button type="button" data-focus-action="favorites">
      ${mapIcon('M6 3h12v18l-6-4-6 4V3Z')}
      <span>저장 <b data-focus-count="favorites">0</b></span>
    </button>
    <button type="button" data-focus-action="collapse">
      ${mapIcon('M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5')}
      <span>지도만</span>
    </button>`;

  root.append(advanced, expandFab, dock);

  const listHandle = document.createElement('div');
  listHandle.className = 'list-sheet-grip';
  listHandle.innerHTML = '<button type="button" class="focus-sheet-handle" aria-label="목록 패널 크기 조절"><span></span></button><button type="button" class="list-sheet-close" aria-label="목록 닫기">×</button>';
  results.prepend(listHandle);

  function isActive() {
    return media.matches && root.classList.contains('mobile-map');
  }

  function updateCounts() {
    const resultText = resultCount?.textContent?.replace(/[^0-9]/g,'') || '0';
    const favoriteText = favoriteCount?.textContent?.replace(/[^0-9]/g,'') || '0';
    dock.querySelector('[data-focus-count="results"]').textContent = resultText || '0';
    dock.querySelector('[data-focus-count="favorites"]').textContent = favoriteText || '0';
  }

  function syncMapType() {
    const button = advanced.querySelector('[data-focus-action="map-type"]');
    const info = onMapTypeState?.() || {};
    button.hidden = !info.supported;
    button.setAttribute('aria-pressed', String(info.type === 'satellite'));
    button.title = info.type === 'satellite' ? '일반 지도 보기' : '위성 지도 보기';
    button.querySelector('span').textContent = info.type === 'satellite' ? '일반' : '위성';
  }

  function scheduleMapLayout(refocus = detailState(state)) {
    requestAnimationFrame(() => {
      onResize?.();
      if (refocus) requestAnimationFrame(() => onRefocus?.());
    });
  }

  function apply(next, { refocus = true } = {}) {
    if (!MAP_FOCUS_STATES.includes(next)) next = 'map-browse';
    state = next;
    if (state === 'map-browse' || state === 'map-collapsed') lastMapState = state;
    document.body.classList.toggle('map-focus-enabled', isActive());
    root.dataset.mapFocusState = state;
    document.body.dataset.mapFocusState = state;
    advanced.querySelector('[data-focus-action="collapse"]')?.setAttribute('aria-pressed', String(state === 'map-collapsed'));
    const expand = dialog.querySelector('[data-focus-expand]');
    if (expand) {
      const expanded = state === 'expanded-tools';
      expand.setAttribute('aria-expanded', String(expanded));
      expand.innerHTML = expanded
        ? `${mapIcon('M7 14l5-5 5 5')}<span>상세 축소</span>`
        : `${mapIcon('M7 10l5 5 5-5')}<span>상세 크게</span>`;
    }
    updateCounts();
    syncMapType();
    scheduleMapLayout(refocus);
  }

  function pushOverlayHistory() {
    if (!isActive() || historyOverlay) return;
    history.pushState({ ...(history.state || {}), evMapFocusOverlay: true }, '', location.href);
    historyOverlay = true;
  }

  function enterBrowse({ consumeHistory = false } = {}) {
    if (!isActive()) return;
    if (consumeHistory && historyOverlay) {
      history.back();
      return;
    }
    historyOverlay = false;
    apply('map-browse', { refocus: false });
  }

  function openDetail() {
    if (!isActive()) return;
    if (!detailState(state)) pushOverlayHistory();
    apply('focus-detail');
    decorateDetail();
  }

  function afterDetailClosed({ fromHistory = false } = {}) {
    if (!isActive()) return;
    if (!fromHistory && historyOverlay) {
      history.back();
      return false;
    }
    historyOverlay = false;
    apply(lastMapState, { refocus: false });
    return true;
  }

  function openList(expanded = false) {
    if (!isActive()) return;
    if (!listState(state)) pushOverlayHistory();
    apply(expanded ? 'list-sheet-expanded' : 'list-sheet', { refocus: true });
    results.querySelector('.list-content')?.focus?.({ preventScroll: true });
  }

  function closeList({ fromHistory = false } = {}) {
    if (!isActive()) return;
    if (!fromHistory && historyOverlay) {
      history.back();
      return;
    }
    historyOverlay = false;
    apply('map-browse', { refocus: false });
  }

  function setSheetOffset(target, value) {
    target?.style?.setProperty('--focus-drag-y', `${Math.max(-120, Math.min(180, value))}px`);
  }

  function bindHandle(handle, target, kind) {
    if (!handle) return;
    const down = event => {
      if (!isActive() || event.button > 0) return;
      drag = { pointerId: event.pointerId, y: event.clientY, target, kind, state };
      handle.setPointerCapture?.(event.pointerId);
      target.classList.add('is-dragging');
      event.preventDefault();
    };
    const move = event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      setSheetOffset(target, event.clientY - drag.y);
      event.preventDefault();
    };
    const end = event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const current = drag;
      drag = null;
      target.classList.remove('is-dragging');
      target.style.removeProperty('--focus-drag-y');
      const next = resolveSheetGesture(current.state, event.clientY - current.y);
      if (current.kind === 'detail' && next === 'map-browse') onCloseDetail?.();
      else if (current.kind === 'list' && next === 'map-browse') closeList();
      else apply(next);
    };
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('keydown', event => {
      if (!isActive()) return;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const next = kind === 'detail' ? 'expanded-tools' : 'list-sheet-expanded';
        apply(next);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = kind === 'detail'
          ? (state === 'expanded-tools' ? 'focus-detail' : 'map-browse')
          : (state === 'list-sheet-expanded' ? 'list-sheet' : 'map-browse');
        if (kind === 'detail' && next === 'map-browse') onCloseDetail?.();
        else if (kind === 'list' && next === 'map-browse') closeList();
        else apply(next);
      }
    });
    cleanups.push(() => {
      handle.removeEventListener('pointerdown', down);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    });
  }

  function decorateDetail() {
    if (!isActive()) return;
    let handle = dialog.querySelector(':scope > .focus-sheet-handle');
    if (!handle) {
      handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'focus-sheet-handle';
      handle.setAttribute('aria-label','상세 패널 크기 조절');
      handle.innerHTML = '<span></span>';
      dialog.prepend(handle);
      bindHandle(handle, dialog, 'detail');
    }
    const toolbar = dialog.querySelector('.detail-toolbar');
    if (toolbar && !toolbar.querySelector('[data-focus-expand]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'focus-detail-expand';
      button.dataset.focusExpand = '';
      button.setAttribute('aria-expanded', String(state === 'expanded-tools'));
      button.innerHTML = `${mapIcon('M7 10l5 5 5-5')}<span>상세 크게</span>`;
      button.addEventListener('click', () => apply(state === 'expanded-tools' ? 'focus-detail' : 'expanded-tools'));
      toolbar.insertBefore(button, toolbar.querySelector('.close-detail'));
    }
  }

  function handleAction(event) {
    const button = event.target.closest('[data-focus-action]');
    if (!button || !isActive()) return;
    const action = button.dataset.focusAction;
    if (action === 'list') openList(false);
    else if (action === 'favorites') { onFavorites?.(); setTimeout(() => openList(false), 0); }
    else if (action === 'map-type') { onToggleMapType?.(); syncMapType(); scheduleMapLayout(detailState(state)); }
    else if (action === 'collapse') apply('map-collapsed', { refocus: false });
    else if (action === 'expand') apply('map-browse', { refocus: false });
  }

  advanced.addEventListener('click', handleAction);
  dock.addEventListener('click', handleAction);
  expandFab.addEventListener('click', handleAction);
  listHandle.querySelector('.list-sheet-close').addEventListener('click', () => closeList());
  bindHandle(listHandle.querySelector('.focus-sheet-handle'), results, 'list');

  const observer = new MutationObserver(updateCounts);
  if (resultCount) observer.observe(resultCount, { childList: true, subtree: true, characterData: true });
  if (favoriteCount) observer.observe(favoriteCount, { childList: true, subtree: true, characterData: true });
  cleanups.push(() => observer.disconnect());

  const mediaChanged = () => {
    document.body.classList.toggle('map-focus-enabled', isActive());
    if (isActive()) apply(state === 'default' ? 'map-browse' : state, { refocus: false });
    else {
      root.removeAttribute('data-map-focus-state');
      document.body.removeAttribute('data-map-focus-state');
      document.body.classList.remove('map-focus-enabled');
    }
  };
  media.addEventListener?.('change', mediaChanged);
  cleanups.push(() => media.removeEventListener?.('change', mediaChanged));

  const pop = () => {
    if (!isActive() || !historyOverlay) return;
    historyOverlay = false;
    if (dialog.open) onCloseDetail?.({ fromHistory: true });
    else if (listState(state)) closeList({ fromHistory: true });
    else apply('map-browse', { refocus: false });
  };
  window.addEventListener('popstate', pop);
  cleanups.push(() => window.removeEventListener('popstate', pop));

  const key = event => {
    if (event.key !== 'Escape' || !isActive()) return;
    if (state === 'expanded-tools' && dialog.open) { event.preventDefault(); apply('focus-detail'); }
    else if (state === 'focus-detail' && dialog.open) { event.preventDefault(); onCloseDetail?.(); }
    else if (state === 'list-sheet-expanded') { event.preventDefault(); apply('list-sheet', { refocus: true }); }
    else if (state === 'list-sheet') { event.preventDefault(); closeList(); }
  };
  window.addEventListener('keydown', key);
  cleanups.push(() => window.removeEventListener('keydown', key));

  updateCounts();
  mediaChanged();

  return {
    isActive,
    getState: () => state,
    enterBrowse,
    openDetail,
    afterDetailClosed,
    openList,
    closeList,
    decorateDetail,
    syncMapCapabilities: syncMapType,
    requestHistoryClose() {
      if (!isActive() || !historyOverlay) return false;
      history.back();
      return true;
    },
    destroy() {
      for (const cleanup of cleanups) cleanup();
      advanced.remove();
      expandFab.remove();
      dock.remove();
      listHandle.remove();
      document.body.classList.remove('map-focus-enabled');
      document.body.removeAttribute('data-map-focus-state');
      root.removeAttribute('data-map-focus-state');
    }
  };
}
