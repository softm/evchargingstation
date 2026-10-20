import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedCardScrollTop, revealSelectedCard } from '../public/js/selection.js';

const setup = ({ current = 0, top = 180, height = 340, scrollHeight = 2600, cardTop = 600 } = {}) => {
  const scroller = {
    scrollTop: current, clientHeight: height, scrollHeight,
    getBoundingClientRect: () => ({ top, height }),
    querySelectorAll: () => [{ dataset: { stationId: 'other' } }, card],
  };
  const card = { dataset: { stationId: 'ST023' }, getBoundingClientRect: () => ({ top: cardTop, height: 210 }) };
  return { scroller, card };
};

test('selected map marker aligns its entire list card near the top of the list scrollport', () => {
  const { scroller, card } = setup({ current: 80, top: 220, cardTop: 620 });
  assert.equal(selectedCardScrollTop(scroller, card), 468);
  assert.equal(revealSelectedCard(scroller, 'ST023'), true);
  assert.equal(scroller.scrollTop, 468);
});

test('scrolling selected card never scrolls page or passes list bounds', () => {
  const { scroller, card } = setup({ current: 1780, height: 400, scrollHeight: 2000, cardTop: 700 });
  assert.equal(selectedCardScrollTop(scroller, card), 1600);
  assert.equal(revealSelectedCard(scroller, 'missing'), false);
  assert.equal(scroller.scrollTop, 1780);
});

test('malicious station identifiers are compared as data, not interpolated into query selectors', () => {
  const { scroller, card } = setup();
  card.dataset.stationId = 'A" onclick="x';
  assert.equal(revealSelectedCard(scroller, 'A" onclick="x'), true);
});
