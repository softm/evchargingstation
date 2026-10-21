// Shared AdFit lifecycle. Only the official banner snippet and NO-AD callback are used.
export const BANNER_AFTER = 6;
export const ADFIT_SCRIPT = 'https://t1.kakaocdn.net/kas/static/ba.min.js';
const DEFAULT_UNIT = {unit:'',width:320,height:100};
const legacyMounted = new WeakMap();
export const UNIT_NAMES = ['list1','list2','list3','bottomDesktop','bottomMobile','welcome'];
export function validAdUnit(unit) { return typeof unit === 'string' && /^DAN-[A-Za-z0-9]{8,64}$/.test(unit); }
export function validAdSize(slot, name = '') {
  return name === 'bottomDesktop' ? slot?.width === 728 && slot?.height === 90
    : name === 'bottomMobile' || name === 'welcome' ? slot?.width === 320 && slot?.height === 100
    : slot?.width === 320 && slot?.height === 100 || slot?.width === 300 && slot?.height === 250;
}
export function normalizeAdConfig(value = {}) {
  const legacy = !value.units && Object.hasOwn(value,'unit');
  const units = Object.fromEntries(UNIT_NAMES.map(name=>[name,{...DEFAULT_UNIT,...(name === 'bottomDesktop' ? {width:728,height:90} : {}),...value.units?.[name]}]));
  if (!units.list1.unit && value.unit) units.list1.unit = value.unit;
  const positions = [...new Set((value.placements?.listInline?.positions || [6,18,30]).filter(n=>Number.isInteger(n)&&n>=6&&n<=200))].sort((a,b)=>a-b).slice(0,3);
  return {enabled:legacy ? value.enabled !== false : value.enabled === true,mode:legacy ? 'adfit' : ['off','preview','adfit'].includes(value.mode) ? value.mode : 'off',script:ADFIT_SCRIPT,
    placements:{listInline:{enabled:true,positions,maxSlots:3,...value.placements?.listInline,positions},
      bottomAnchor:{enabled:true,mobileDefaultExpanded:false,desktopDefaultExpanded:true,...value.placements?.bottomAnchor},
      welcome:{enabled:false,adfitApproved:false,oncePerSession:true,...value.placements?.welcome}},units};
}
export function createAdManager({config = {},preview = false,demo = false,win = window,doc = document,location = win.location} = {}) {
  config = normalizeAdConfig(config);
  preview = preview || config.mode === 'preview';
  const production = location?.origin === 'https://softm.github.io' && location.pathname.startsWith('/evchargingstation/');
  const enabled = config.enabled && config.mode === 'adfit' && production && !demo && !preview;
  const claimed = new Set(), slots = new Map(); let serial = 0, blocked = false;
  function slot({host,unit,name,root = null,onChange = () => {}}) {
    if (slots.has(host)) return slots.get(host);
    let state = !validAdUnit(unit?.unit) || !validAdSize(unit,name) ? 'unconfigured' : enabled ? 'idle' : 'disabled';
    let eligible = false, allowed = true, requested = false, inView = false, io, mutation, timer, ins, script, disposed = false;
    const callback = `evAdFitNoAd_${name.replace(/\W/g,'')}_${++serial}`;
    const creative = host.querySelector('.adfit-creative');
    const terminal = () => ['no-ad','error'].includes(state) || disposed;
    function change(next) { state=next;host.dataset.adState=next;onChange(next); }
    function fits() { return host.getBoundingClientRect().width >= unit.width; }
    function cleanup() { win.clearTimeout(timer);io?.disconnect();mutation?.disconnect(); }
    function failure(next) { if (disposed || terminal()) return;cleanup();ins?.remove();script?.remove();host.hidden=true;change(next); }
    function loaded() { if (state !== 'loading' || !creative.querySelector('iframe')) return false;win.clearTimeout(timer);mutation?.disconnect();change('loaded');return true; }
    function visible() {
      const box=host.getBoundingClientRect(), area=root?.getBoundingClientRect?.() || {top:0,bottom:win.innerHeight};
      return box.height>0 && box.bottom>area.top && box.top<area.bottom && win.getComputedStyle?.(host)?.visibility !== 'hidden';
    }
    function request() {
      if (disposed || requested || terminal() || preview || !enabled || !eligible || !allowed || blocked || doc.hidden || host.hidden || !fits() || !visible() || (io && !inView)) return;
      if (claimed.has(unit.unit) || claimed.size >= 4) { failure('error');return; }
      requested=true;claimed.add(unit.unit);io?.disconnect();change('loading');
      ins=doc.createElement('ins');ins.className='kakao_ad_area';ins.style.display='none';ins.style.width='100%';
      ins.setAttribute('data-ad-unit',unit.unit);ins.setAttribute('data-ad-width',String(unit.width));ins.setAttribute('data-ad-height',String(unit.height));ins.setAttribute('data-ad-onfail',callback);
      win[callback]=element=>{if(element===ins)failure('no-ad');};
      script=doc.createElement('script');script.async=true;script.type='text/javascript';script.charset='utf-8';script.src=ADFIT_SCRIPT;
      script.onerror=()=>failure('error');
      script.onload=()=>{win.clearTimeout(timer);if(terminal())return;if(!loaded())timer=win.setTimeout(()=>{if(!loaded())failure('error');},30000);};
      if(win.MutationObserver){mutation=new win.MutationObserver(loaded);mutation.observe(creative,{childList:true,subtree:true});}
      timer=win.setTimeout(()=>{if(!loaded())failure('error');},20000);
      creative.append(ins,script);
    }
    function sync() {
      if (disposed) return;
      host.hidden = !eligible || !allowed || terminal() || (!preview && (!enabled || !validAdUnit(unit?.unit) || !validAdSize(unit,name)));
      if (host.hidden) return;
      host.style.setProperty('--ad-width',`${unit.width}px`);host.style.setProperty('--ad-height',`${unit.height}px`);
      if (!fits()) {host.hidden=true;return;}
      if (preview) {
        host.dataset.adMode='preview';
        creative.textContent=`광고 배치 미리보기 · ${unit.width} × ${unit.height}\n실제 광고가 아닙니다`;
        return;
      }
      if (!requested && !io && win.IntersectionObserver) {
        io=new win.IntersectionObserver(entries=>{inView=entries.some(e=>e.isIntersecting&&e.intersectionRatio>=0.5);request();},{root,threshold:0.5});io.observe(host);
      } else if (io && !requested) {io.unobserve(host);io.observe(host);}
      if (!io) request();
    }
    const controller={get state(){return state;},get requested(){return requested;},get failed(){return terminal();},
      update(next = {}) {if(Object.hasOwn(next,'eligible'))eligible=next.eligible;if(Object.hasOwn(next,'allowed'))allowed=next.allowed;sync();},sync,
      destroy(){disposed=true;cleanup();ins?.remove();script?.remove();delete win[callback];host.hidden=true;slots.delete(host);}};
    host.hidden=true;host.dataset.adState=preview?'idle':state;slots.set(host,controller);return controller;
  }
  const sync=()=>slots.forEach(s=>s.sync());
  const resize=()=>sync();
  doc.addEventListener('visibilitychange',sync);win.addEventListener('resize',resize,{passive:true});
  return {config,preview,enabled,slot,sync,get requestCount(){return claimed.size;},setBlocked(value){blocked=Boolean(value);sync();},
    destroy(){slots.forEach(s=>s.destroy());doc.removeEventListener('visibilitychange',sync);win.removeEventListener('resize',resize);}};
}
// Compatibility for integrations using the original single-banner entry point.
export function mountAdBanner({host,root,...options}) {
  if (legacyMounted.has(host)) return legacyMounted.get(host);
  const manager=createAdManager(options), controller=manager.slot({host,root,name:'list1',unit:manager.config.units.list1});
  const api={update(count){controller.update({eligible:count>BANNER_AFTER});},destroy(){manager.destroy();legacyMounted.delete(host);}};
  legacyMounted.set(host,api);return api;
}
