/** Browser location resolution modeled after care-location.js, without external coordinate storage. */
export function locationMessage(reason) {
  const messages = {
    denied: '위치 권한이 차단되어 있습니다. 브라우저에서 권한을 허용하거나 지역을 직접 선택해 주세요.',
    unavailable: '현재 위치를 확인하지 못했습니다. 내 위치 버튼으로 재시도하거나 지역을 선택하세요.',
    timeout: '위치 확인이 지연되고 있습니다. 내 위치 버튼으로 재시도하거나 지역을 선택하세요.',
    insecure: '현재 위치는 HTTPS 환경에서만 사용할 수 있습니다. 지역을 선택하세요.',
    policy: '이 화면에서는 위치 접근이 제한되어 있습니다. 사이트를 브라우저에서 직접 열어 주세요.',
    unsupported: '이 브라우저는 위치 확인을 지원하지 않습니다. 지역을 선택해 주세요.',
    outside: '국내 지도 범위를 벗어나 기본 위치에서 시작합니다. 지역을 직접 선택하세요.'
  };
  return messages[reason] || messages.unavailable;
}
export async function getBrowserLocation({ env = globalThis, retryHighAccuracy = true } = {}) {
  if (env.isSecureContext === false) return { point: null, reason: 'insecure' };
  const policy = env.document?.permissionsPolicy || env.document?.featurePolicy;
  if (policy?.allowsFeature && !policy.allowsFeature('geolocation')) return { point: null, reason: 'policy' };
  const service = env.navigator?.geolocation;
  if (typeof service?.getCurrentPosition !== 'function') return { point: null, reason: 'unsupported' };
  try {
    const permission = await env.navigator?.permissions?.query?.({ name: 'geolocation' });
    if (permission?.state === 'denied') return { point: null, reason: 'denied' };
  } catch { /* Browser permission querying is optional; the native request decides. */ }
  const attempt = high => new Promise((resolve, reject) => {
    try {
      service.getCurrentPosition(position => {
        const lat = position?.coords?.latitude, lng = position?.coords?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)
          || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          reject({ reason: 'unavailable' });
        } else resolve({ lat, lng });
      }, error => reject({ reason: ({ 1: 'denied', 2: 'unavailable', 3: 'timeout' })[error?.code] || 'unavailable' }), {
        enableHighAccuracy: high,
        timeout: high ? 12000 : 8000,
        maximumAge: 60000
      });
    } catch { reject({ reason: 'unavailable' }); }
  });
  try {
    let point;
    try { point = await attempt(false); }
    catch (error) {
      if (!retryHighAccuracy || !['timeout', 'unavailable'].includes(error.reason)) throw error;
      point = await attempt(true);
    }
    if (point.lat < 32 || point.lat > 40 || point.lng < 123 || point.lng > 133)
      return { point: null, reason: 'outside' };
    return { point, reason: '' };
  } catch (error) { return { point: null, reason: error?.reason || 'unavailable' }; }
}
