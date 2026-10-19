/** SOFTM-MARKER-PLACEMENT START 날짜:20260930 : 위쪽이 막혀도 핀의 실제 위치를 유지하며 주변 여유 공간에서 기관명을 읽도록 배치 후보를 비교 */
(function(root) {
    const sides = ['top', 'right', 'left', 'bottom'];
    const valid = rect => rect && rect.width > 0 && rect.height > 0 &&
        ['left', 'top', 'right', 'bottom', 'width', 'height'].every(key => Number.isFinite(rect[key]));
    const overlaps = (a, b) => a.left < b.right + 6 && a.right + 6 > b.left &&
        a.top < b.bottom + 6 && a.bottom + 6 > b.top;
    const inside = (rect, bounds) => rect.left >= bounds.left + 8 && rect.right <= bounds.right - 8 &&
        rect.top >= bounds.top + 8 && rect.bottom <= bounds.bottom - 8;

    function candidate(rect, pin, side) {
        const { width, height } = rect;
        let left = rect.left;
        let top = rect.top;
        if (side === 'right' || side === 'left') {
            left = side === 'right' ? pin.right + 10 : pin.left - 10 - width;
            top = pin.top + (pin.height - height) / 2;
        } else if (side === 'bottom') {
            left = pin.left + (pin.width - width) / 2;
            top = pin.bottom + 10;
        }
        return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height };
    }

    function fit(rects, pin, bounds, obstacles, preferred = 'top') {
        if (!Array.isArray(rects) || !valid(pin) || !valid(bounds)) return null;
        const orderedSides = sides.includes(preferred) ? [preferred, ...sides.filter(side => side !== preferred)] : sides;
        const occupied = (obstacles || []).filter(valid);
        for (let level = rects.length - 1; level >= 0; level--) {
            const source = rects[level];
            if (!valid(source)) continue;
            for (const side of orderedSides) {
                const rect = candidate(source, pin, side);
                if (inside(rect, bounds) && !occupied.some(other => overlaps(rect, other))) {
                    return { level, side, rect, dx: rect.left - source.left, dy: rect.top - source.top };
                }
            }
        }
        return null;
    }

    root.CareMarkerPlacement = { fit };
})(globalThis);
/** SOFTM-MARKER-PLACEMENT END */
