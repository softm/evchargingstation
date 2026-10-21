import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedCardScrollTop, revealSelectedCard, centeredListStation, bindListScrollSelection } from '../public/js/selection.js';

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

test('scroll selection follows the center, first/last edges and ignores advertisements and invisible cards',()=>{
 const card=(id,top,height)=>({dataset:{stationId:id},getBoundingClientRect:()=>({top,bottom:top+height,height})});
 const scroller={scrollTop:400,scrollHeight:2000,clientHeight:600,getBoundingClientRect:()=>({top:100,height:600}),querySelectorAll:()=>[
   card('above',-200,200),card('first',50,200),card('center',270,200),card('last',510,200),card('hidden',0,0)]};
 assert.equal(centeredListStation(scroller),'center');
 scroller.scrollTop=0;assert.equal(centeredListStation(scroller),'first');
 scroller.scrollTop=1400;assert.equal(centeredListStation(scroller),'last');
 scroller.clientHeight=0;scroller.getBoundingClientRect=()=>({top:0,height:0});assert.equal(centeredListStation(scroller),null);
});

test('only user scroll settles select: programmatic reveal, rapid events and teardown cannot create feedback loops',()=>{
 const handlers=new Map(), tasks=new Map(),selected=[];let serial=0;
 const card={dataset:{stationId:'NT100483'},getBoundingClientRect:()=>({top:80,bottom:280,height:200})};
 const scroller={scrollTop:0,scrollHeight:1000,clientHeight:400,getBoundingClientRect:()=>({top:0,height:400}),querySelectorAll:()=>[card],
 addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};
 const sync=bindListScrollSelection(scroller,id=>selected.push(id),{schedule:fn=>{tasks.set(++serial,fn);return serial;},cancel:id=>tasks.delete(id)});
 handlers.get('scroll')();assert.equal(tasks.size,0);
 handlers.get('wheel')({type:'wheel'});handlers.get('scroll')();handlers.get('scroll')();assert.equal(tasks.size,1);
 for(const fn of tasks.values()) fn();tasks.clear();assert.deepEqual(selected,['NT100483']);
 sync.suppress();handlers.get('scroll')();assert.equal(tasks.size,0);
 handlers.get('keydown')({type:'keydown',key:'a'});handlers.get('scroll')();assert.equal(tasks.size,0);
 handlers.get('touchstart')({type:'touchstart'});handlers.get('scroll')();assert.equal(tasks.size,1);
 sync.destroy();assert.equal(tasks.size,0);assert.equal(handlers.size,0);
});
