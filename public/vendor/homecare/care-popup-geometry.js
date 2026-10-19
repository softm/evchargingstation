/** SOFTM-POPUP-GEOMETRY START 날짜:20260924 : 팝업 방향과 지도 여백을 함께 계산해 선택 기관이 가려지지 않도록 두 지도의 위치 기준을 통일 */
(() => {
    const finite = value => Number.isFinite(value);
    function rect(left, top, right, bottom) {
        return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    }
    function normalize(value) {
        if (!value || !finite(value.left) || !finite(value.top)) return null;
        const right = finite(value.right) ? value.right : value.left + value.width;
        const bottom = finite(value.bottom) ? value.bottom : value.top + value.height;
        return finite(right) && finite(bottom) && right >= value.left && bottom >= value.top ? rect(value.left, value.top, right, bottom) : null;
    }
    const margin = (value, fallback) => finite(value) ? Math.max(0, value) : fallback;
    function visibleRect(mapRect, panelRect, { top = 72, right = 24, bottom = 24, left = 24, gap = 24 } = {}) {
        const map = normalize(mapRect);
        if (!map) return rect(0, 0, 0, 0);
        const insetTop = margin(top, 72), insetRight = margin(right, 24), insetBottom = margin(bottom, 24), insetLeft = margin(left, 24);
        const scaleX = Math.min(1, map.width / Math.max(1, insetLeft + insetRight));
        const scaleY = Math.min(1, map.height / Math.max(1, insetTop + insetBottom));
        const safe = rect(map.left + insetLeft * scaleX, map.top + insetTop * scaleY, map.right - insetRight * scaleX, map.bottom - insetBottom * scaleY);
        const panel = normalize(panelRect);
        if (!panel || !panel.width || !panel.height || panel.right <= safe.left || panel.left >= safe.right || panel.bottom <= safe.top || panel.top >= safe.bottom) return safe;
        const spacing = margin(gap, 24);
        const candidates = [
            rect(safe.left, safe.top, safe.right, Math.max(safe.top, Math.min(safe.bottom, panel.top - spacing))),
            rect(safe.left, Math.min(safe.bottom, Math.max(safe.top, panel.bottom + spacing)), safe.right, safe.bottom),
            rect(safe.left, safe.top, Math.max(safe.left, Math.min(safe.right, panel.left - spacing)), safe.bottom),
            rect(Math.min(safe.right, Math.max(safe.left, panel.right + spacing)), safe.top, safe.right, safe.bottom)
        ];
        const usable = candidates.filter(candidate => candidate.width >= 48 && candidate.height >= 48);
        return (usable.length ? usable : candidates).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    }
    function focusCenter(position, bounds, mapRect, panelRect, options) {
        const map = normalize(mapRect);
        if (!map?.width || !map.height || !position || !bounds || ![position.lat, position.lng, bounds.north, bounds.south, bounds.east, bounds.west].every(finite)) return position;
        const visible = visibleRect(map, panelRect, options);
        if (!visible.width || !visible.height) return { lat: position.lat, lng: position.lng };
        const offsetX = (visible.left + visible.width / 2 - map.left) / map.width - 0.5;
        const offsetY = (visible.top + visible.height / 2 - map.top) / map.height - 0.5;
        return {
            lat: position.lat + (bounds.north - bounds.south) * offsetY,
            lng: position.lng - (bounds.east - bounds.west) * offsetX
        };
    }
    globalThis.CarePopupGeometry = Object.freeze({ visibleRect, focusCenter });
})();
/** SOFTM-POPUP-GEOMETRY END */
