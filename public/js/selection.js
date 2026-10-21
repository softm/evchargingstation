/**
 * Keep a selected charger card fully visible without scrolling the map or page.
 * The sidebar gets its own scrollport, so do not use Element.scrollIntoView().
 */
export function selectedCardScrollTop(scroller, card, padding = 12) {
  if (!scroller || !card) return null;
  const viewport = scroller.getBoundingClientRect();
  const bounds = card.getBoundingClientRect();
  const height = scroller.clientHeight || viewport.height;
  if (![viewport.top, bounds.top, height, scroller.scrollTop, scroller.scrollHeight].every(Number.isFinite)) return null;
  const inset = Math.max(0, Math.min(32, Number(padding) || 0));
  const target = scroller.scrollTop + bounds.top - viewport.top - inset;
  return Math.min(Math.max(0, scroller.scrollHeight - height), Math.max(0, target));
}

export function revealSelectedCard(scroller, stationId) {
  if (!scroller || stationId == null) return false;
  const card = [...scroller.querySelectorAll('.station-card')]
    .find(element => element.dataset.stationId === String(stationId));
  if (!card) return false;
  const top = selectedCardScrollTop(scroller, card);
  if (top === null) return false;
  scroller.scrollTop = top;
  return true;
}

/** Pick a visible result card; ad slots and off-screen cards cannot be selected. */
export function centeredListStation(scroller) {
  const viewport = scroller.getBoundingClientRect();
  const height = scroller.clientHeight || viewport.height;
  if (!Number.isFinite(height) || height <= 0) return null;
  const top = viewport.top, bottom = top+height, center = top+height/2;
  const cards = [...scroller.querySelectorAll('.station-card')].map(card=>({id:card.dataset.stationId,rect:card.getBoundingClientRect()}))
    .filter(({id,rect})=>id && rect.height > 0 && rect.bottom > top && rect.top < bottom);
  if (!cards.length) return null;
  if (scroller.scrollTop <= 1) return cards[0].id;
  if (scroller.scrollTop+height >= scroller.scrollHeight-1) return cards.at(-1).id;
  return cards.sort((a,b)=>Math.abs((a.rect.top+a.rect.bottom)/2-center)-Math.abs((b.rect.top+b.rect.bottom)/2-center))[0].id;
}

/** Only a user scroll can select. Programmatic card reveals must not loop back. */
export function bindListScrollSelection(scroller, onSelect, {schedule = setTimeout, cancel = clearTimeout, onIntent = () => {}} = {}) {
  let active = false, timer;
  const stop = () => { active = false; cancel(timer); };
  const intent = event => {
    if (event.type === 'keydown' && !['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key)) return;
    active = true;
    onIntent();
  };
  const scroll = () => {
    cancel(timer);
    if (!active) return;
    timer = schedule(()=>{ if (active) { const id = centeredListStation(scroller); if (id) onSelect(id); } },180);
  };
  for (const type of ['wheel','touchstart','pointerdown','keydown']) scroller.addEventListener(type,intent,{passive:true});
  scroller.addEventListener('scroll',scroll,{passive:true});
  return {suppress:stop,destroy() {
    stop();
    for (const type of ['wheel','touchstart','pointerdown','keydown']) scroller.removeEventListener(type,intent);
    scroller.removeEventListener('scroll',scroll);
  }};
}
