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
