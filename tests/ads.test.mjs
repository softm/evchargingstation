import test from 'node:test';
import assert from 'node:assert/strict';
import { ADFIT_SCRIPT, mountAdBanner, validAdUnit } from '../public/js/ads.js';

function fixture({ unit = 'DAN-TestOnly12345678', ...options } = {}) {
  const created = [], listeners = new Map(), timers = new Map();
  class Node {
    constructor(tag) { this.tag = tag; this.dataset = {}; this.style = {}; this.children = []; this.attributes = {}; this.classList = { add: () => {} }; }
    setAttribute(key, value) { this.attributes[key] = value; }
    append(...nodes) { this.children.push(...nodes); }
    remove() { this.removed = true; }
    getBoundingClientRect() { return { width: 380, height: this.hidden ? 0 : 180 }; }
    querySelector(selector) { return selector === '.adfit-creative' ? creative : selector === 'iframe' ? this.iframe : null; }
  }
  const host = new Node('aside'), root = new Node('div'), creative = new Node('div');
  class Observer {
    constructor(callback, settings) { this.callback = callback; this.settings = settings; }
    observe(node) { this.node = node; }
    unobserve() {}
    disconnect() { this.disconnected = true; }
    visible() { this.callback([{ isIntersecting: true }]); }
  }
  const doc = { hidden: false, createElement(tag) { const node = new Node(tag); created.push(node); return node; },
    addEventListener(name, callback) { listeners.set(name, callback); } };
  let observer;
  const win = { location: { origin: 'https://softm.github.io', pathname: '/evchargingstation/' },
    IntersectionObserver: class extends Observer { constructor(...args) { super(...args); observer = this; } },
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  const args = { host, root, config: { enabled: true, unit }, win, doc, ...options };
  const controller = mountAdBanner(args);
  return { host, creative, root, doc, win, created, timers, listeners, controller, args, observer: () => observer };
}

test('unconfigured, disabled, demo and non-production mounts never request a real ad', () => {
  for (const options of [{unit:''}, {unit:'invented'}, {config:{enabled:false,unit:'DAN-TestOnly12345678'}}, {demo:true},
    {location:{origin:'http://localhost:8000',pathname:'/'}}, {location:{origin:'https://softm.github.io',pathname:'/another-site/'}}]) {
    const f = fixture(options);
    f.controller.update(60);
    assert.equal(f.host.hidden, true);
    assert.equal(f.created.length, 0);
    assert.equal(f.observer(), undefined);
  }
  assert.equal(validAdUnit('DAN-abc" onload="bad'), false);
});

test('ad preview is explicit and cannot request the SDK, even with a configured unit', () => {
  const f = fixture({preview:true});
  f.controller.update(10);
  assert.equal(f.host.hidden, false);
  assert.match(f.creative.textContent, /실제 광고가 아닙니다/);
  assert.equal(f.created.length, 0);
  assert.equal(f.observer(), undefined);
});

test('the single persistent slot is requested only when six results precede it and it becomes visible', () => {
  const f = fixture();
  f.controller.update(6);
  assert.equal(f.host.hidden, true);
  assert.equal(f.observer(), undefined);
  f.controller.update(7);
  assert.equal(f.created.length, 0);
  assert.equal(f.observer().settings.root, f.root);
  assert.equal(f.observer().settings.threshold, 0.5);
  f.observer().visible();
  const [ins, script] = f.created;
  assert.equal(ins.attributes['data-ad-width'], '320');
  assert.equal(ins.attributes['data-ad-height'], '100');
  assert.equal(ins.attributes['data-ad-onfail'], 'evAdFitNoAd');
  assert.equal(script.src, ADFIT_SCRIPT);
  assert.equal(script.async, true);
  for (const count of [60,12,1,60]) f.controller.update(count);
  f.observer().visible();
  assert.deepEqual(f.creative.children, [ins, script]);
  assert.equal(mountAdBanner(f.args), f.controller);
  assert.equal(f.created.length, 2, 'filtering, refresh, hiding and remounting cannot reload the ad');
});

test('background, hidden and undersized slots do not request; returning to a visible tab can request once', () => {
  const f = fixture();
  f.controller.update(20);
  f.doc.hidden = true;
  f.observer().visible();
  assert.equal(f.created.length, 0);
  f.doc.hidden = false;
  f.host.getBoundingClientRect = () => ({width:300,height:180});
  f.observer().visible();
  assert.equal(f.created.length, 0);
  f.host.getBoundingClientRect = () => ({width:380,height:0});
  f.observer().visible();
  assert.equal(f.created.length, 0);
  f.host.getBoundingClientRect = () => ({width:380,height:180});
  f.listeners.get('visibilitychange')();
  f.observer().visible();
  assert.equal(f.created.length, 2);
});

test('official NO-AD and script-block errors collapse the slot with no retry on later result renders', () => {
  for (const reason of ['no-ad','script-error','timeout']) {
    const f = fixture();
    f.controller.update(20);
    f.observer().visible();
    const [ins,script] = f.created;
    if (reason === 'no-ad') {
      f.win.evAdFitNoAd({});
      assert.equal(f.host.hidden, false, 'ignore callbacks for unrelated slots');
      f.win.evAdFitNoAd(ins);
    } else if (reason === 'script-error') script.onerror();
    else [...f.timers.values()][0]();
    assert.equal(ins.removed, true);
    assert.equal(f.host.hidden, true);
    assert.equal(f.host.dataset.adState, 'unfilled');
    f.controller.update(60);
    f.observer().visible();
    assert.equal(f.host.hidden, true);
    assert.equal(f.created.length, 2);
  }
});

test('a received iframe is retained on the timeout check; it is not treated as a paid impression', () => {
  const f = fixture();
  f.controller.update(20);
  f.observer().visible();
  f.host.iframe = {};
  [...f.timers.values()][0]();
  assert.equal(f.host.hidden, false);
  assert.equal(f.host.dataset.adState, 'requested');
});
