// SOFTM-ADFIT 날짜:20261020 : 돌봄한눈의 비동기 배너·NO-AD 처리를 참고.
// One persistent slot: filtering, polling and map movement never reload the SDK.
export const BANNER_AFTER = 6;
export const ADFIT_SCRIPT = 'https://t1.kakaocdn.net/kas/static/ba.min.js';
const mounted = new WeakMap();

export function validAdUnit(unit) {
  return typeof unit === 'string' && /^DAN-[A-Za-z0-9]{8,64}$/.test(unit);
}

export function mountAdBanner({ host, root, config = {}, preview = false, demo = false,
  win = window, doc = document, location = win.location } = {}) {
  if (!host) return { update() {} };
  if (mounted.has(host)) return mounted.get(host);
  let count = 0, requested = false, failed = false, observer, timer, ins;
  const production = location?.origin === 'https://softm.github.io'
    && location.pathname.startsWith('/evchargingstation/');
  const enabled = config.enabled !== false && validAdUnit(config.unit) && production && !demo;
  const setState = value => { host.dataset.adState = value; };
  const hide = () => { host.hidden = true; };
  hide();
  setState(preview ? 'preview' : !validAdUnit(config.unit) ? 'unconfigured' : enabled ? 'idle' : 'disabled');

  function fail(element) {
    if (element && element !== ins) return;
    failed = true;
    win.clearTimeout(timer);
    observer?.disconnect();
    ins?.remove();
    hide();
    setState('unfilled');
  }

  function request() {
    if (requested || failed || count <= BANNER_AFTER || doc.hidden || host.hidden) return;
    const rect = host.getBoundingClientRect();
    // Fixed creative size: never crop, scale, or load in a hidden mobile list.
    if (rect.width < 320 || rect.height === 0) return;
    requested = true;
    observer?.disconnect();
    setState('requested');
    ins = doc.createElement('ins');
    ins.className = 'kakao_ad_area';
    ins.style.display = 'none';
    ins.style.width = '100%';
    ins.setAttribute('data-ad-unit', config.unit);
    ins.setAttribute('data-ad-width', '320');
    ins.setAttribute('data-ad-height', '100');
    ins.setAttribute('data-ad-onfail', 'evAdFitNoAd');
    win.evAdFitNoAd = fail;
    const script = doc.createElement('script');
    script.async = true;
    script.type = 'text/javascript';
    script.charset = 'utf-8';
    script.src = ADFIT_SCRIPT;
    script.onerror = () => fail();
    timer = win.setTimeout(() => {
      // An iframe is only a rendering signal, never proof of a paid impression.
      if (!host.querySelector('iframe')) fail();
    }, 8000);
    host.querySelector('.adfit-creative').append(ins, script);
  }

  const controller = { update(resultCount) {
    count = resultCount;
    host.hidden = count <= BANNER_AFTER || failed || (!enabled && !preview);
    if (host.hidden) return;
    if (preview) {
      host.classList.add('adfit-preview');
      host.querySelector('.adfit-creative').textContent = '광고 배치 미리보기 · 실제 광고가 아닙니다';
      return;
    }
    if (requested) return;
    if (!observer && win.IntersectionObserver) {
      observer = new win.IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) request();
      }, { root, threshold: 0.5 });
      observer.observe(host);
    } else if (!win.IntersectionObserver) request();
  } };
  mounted.set(host, controller);
  // If a visible slot was reached in a background tab, request only on return.
  doc.addEventListener('visibilitychange', () => {
    if (observer && !requested && !failed) { observer.unobserve(host); observer.observe(host); }
  });
  return controller;
}
