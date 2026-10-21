import { XMLParser, XMLValidator } from 'fast-xml-parser';

const UPSTREAM = 'https://apis.data.go.kr/B552584/EvCharger/getChargerInfo';
const MAX_BYTES = 2 * 1024 * 1024;
export const CACHE_SECONDS = 120;
const xml = new XMLParser({parseTagValue:false, ignoreAttributes:true, processEntities:false});
export class StatusError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}
const fail = code => { throw new StatusError(code); };
const count = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : fail('INVALID_RESPONSE');
const providerCode = value => {
  if (value === null || value === undefined || !/^\d{1,2}$/.test(String(value))) fail('INVALID_RESPONSE');
  const code = String(value ?? '').padStart(2,'0');
  if (code === '00') return;
  throw new StatusError(['20','21','30','31','32'].includes(code) ? 'AUTH_ERROR' : code === '22' ? 'DAILY_LIMIT' : code === '23' ? 'RATE_LIMIT' : 'UPSTREAM_ERROR');
};

export function sourceTime(value) {
  const s = String(value || '');
  if (!/^\d{14}$/.test(s)) return null;
  const local = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}+09:00`;
  const date = new Date(local);
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime()+9*3600000).toISOString().slice(0,19).replace(/[-:T]/g,'') !== s) return null;
  return date.toISOString();
}

export function parseStation(text, stationId, region, observedAt, expectedOperator) {
  let document;
  try {
    if (text.trimStart().startsWith('<')) {
      if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) fail('INVALID_RESPONSE');
      document = xml.parse(text);
    } else document = JSON.parse(text);
  } catch { fail('INVALID_RESPONSE'); }
  const gateway = document?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gateway) providerCode(gateway.returnReasonCode);
  const root = document?.response || document;
  const header = root?.header || root;
  const body = root?.body || root;
  providerCode(header?.resultCode);
  const total = count(body?.totalCount ?? header?.totalCount);
  if (count(body?.pageNo ?? header?.pageNo) !== 1 || total > 2000) fail('INCOMPLETE_RESPONSE');
  const items = body?.items?.item ?? body?.items;
  const rows = Array.isArray(items) ? items : items && typeof items === 'object' && total === 1 ? [items] : [];
  if (rows.length !== total) fail('INCOMPLETE_RESPONSE');
  if (!total) throw new StatusError('NOT_FOUND',404);
  const seen = new Set();
  const chargers = [];
  for (const row of rows) {
    // A silently ignored upstream filter must never refresh another station.
    if (String(row.statId) !== stationId || String(row.zcode) !== region
      || (expectedOperator && String(row.busiId) !== expectedOperator)) fail('IDENTITY_MISMATCH');
    const id = String(row.chgerId ?? '');
    if (!/^[A-Za-z0-9_-]{1,10}$/.test(id) || seen.has(id)) fail('IDENTITY_MISMATCH');
    seen.add(id);
    if (row.delYn === 'Y') continue;
    chargers.push({id, status:/^[0-6]$|^9$/.test(String(row.stat)) ? String(row.stat) : '0',
      observedAt, statusChangedAt:sourceTime(row.statUpdDt), lastStartedAt:sourceTime(row.lastTsdt),
      lastEndedAt:sourceTime(row.lastTedt), currentStartedAt:sourceTime(row.nowTsdt)});
  }
  if (!chargers.length) throw new StatusError('NOT_FOUND',404);
  return {schemaVersion:1, kind:'station-status', stationId, regionCode:region, observedAt, chargers, complete:true, source:'한국환경공단 충전소 정보 API'};
}

async function readLimited(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) fail('RESPONSE_TOO_LARGE');
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); fail('RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export function createStatusService({cache, registry, serviceKey = '', fetcher = fetch, now = Date.now, maxCalls = 200, logger = console}) {
  const pending = new Map();
  let day = '', used = 0;
  const prefix = 'evchargingstation:status:v1:';
  const configured = Boolean(serviceKey.trim());
  const get = async key => { try { return await cache.get(prefix+key); } catch { throw new StatusError('CACHE_UNAVAILABLE',503); } };
  const set = async (key,value,ttl) => { try { await cache.set(prefix+key,value,{ttl}); } catch { throw new StatusError('CACHE_UNAVAILABLE',503); } };
  const recent = value => value?.schemaVersion === 1 && now()-Date.parse(value.observedAt) >= 0 && now()-Date.parse(value.observedAt) < CACHE_SECONDS*1000;
  async function station(stationId, region) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(stationId) || !/^\d{2}$/.test(region)) throw new StatusError('INVALID_REQUEST',400);
    if (!Object.hasOwn(registry.stations,stationId) || registry.stations[stationId][0] !== region) throw new StatusError('NOT_FOUND',404);
    if (!configured) throw new StatusError('UNCONFIGURED',503);
    const key = `${region}:${stationId}`;
    const cached = await get(key);
    if (recent(cached)) return {...cached,cached:true};
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 2) throw new StatusError('BUSY',429);
    const task = (async () => {
      const blocked = await get('blocked');
      if (blocked?.until > now()) throw new StatusError(blocked.code,503);
      const today = new Date(now()+9*3600000).toISOString().slice(0,10);
      if (today !== day) { day = today; used = 0; }
      // Safety ceiling for this warm instance, not a durable global quota.
      // The provider enforces the key-wide limit; shared cache reduces calls.
      if (used >= maxCalls) throw new StatusError('INSTANCE_LIMIT',429);
      used++;
      const url = new URL(UPSTREAM);
      let decoded; try { decoded = decodeURIComponent(serviceKey.trim()); } catch { throw new StatusError('AUTH_ERROR',503); }
      url.search = new URLSearchParams({serviceKey:decoded,dataType:'JSON',pageNo:'1',numOfRows:'9999',statId:stationId,zcode:region});
      try {
        const response = await fetcher(url,{headers:{Accept:'application/json, application/xml'},signal:AbortSignal.timeout(12000),redirect:'error'});
        const text = await readLimited(response);
        // Gateway auth/quota errors can be returned with either HTTP 200 or 4xx.
        if (!response.ok) {
          try { parseStation(text,stationId,region,new Date(now()).toISOString()); }
          catch (error) { if (['AUTH_ERROR','DAILY_LIMIT','RATE_LIMIT'].includes(error.code)) throw error; }
          throw new StatusError(response.status === 429 ? 'RATE_LIMIT' : 'UPSTREAM_HTTP_ERROR');
        }
        const data = parseStation(text,stationId,region,new Date(now()).toISOString(),registry.stations[stationId][1]);
        await set(key,data,86400);
        await set('last-attempt',{status:'success',attemptedAt:data.observedAt,observedAt:data.observedAt,stationId,chargerCount:data.chargers.length},86400);
        await set('last-success',{observedAt:data.observedAt,stationId,chargerCount:data.chargers.length},86400);
        return {...data,cached:false};
      } catch (error) {
        const safe = error instanceof StatusError ? error : new StatusError('NETWORK_ERROR');
        const attemptedAt = new Date(now()).toISOString();
        // Never log a URL, key, upstream message, exception object or response.
        logger.error('EV status lookup failed',{code:safe.code});
        await set('last-attempt',{status:'error',attemptedAt,stationId,code:safe.code},86400);
        if (['DAILY_LIMIT','AUTH_ERROR','RATE_LIMIT','NETWORK_ERROR','UPSTREAM_HTTP_ERROR'].includes(safe.code)) {
          await set('blocked',{code:safe.code,until:now()+(['AUTH_ERROR','DAILY_LIMIT'].includes(safe.code) ? 900000 : 60000)},900);
        }
        throw safe;
      }
    })();
    pending.set(key,task);
    try { return await task; } finally { pending.delete(key); }
  }
  async function health() {
    let attempt = null, blocked = null, lastSuccess = null, cacheReady = true;
    try { [attempt,blocked,lastSuccess] = await Promise.all([get('last-attempt'),get('blocked'),get('last-success')]); } catch { cacheReady = false; }
    return {schemaVersion:1, kind:'status-api-health', configured, ready:configured && cacheReady && !(blocked?.until > now()), cacheReady,
      cacheSeconds:CACHE_SECONDS, registryCollectedAt:registry.collectedAt, knownStations:Object.keys(registry.stations).length,
      lastAttempt:attempt, lastSuccess, upstreamBlockedUntil:blocked?.until > now() ? new Date(blocked.until).toISOString() : null,
      code:!configured ? 'UNCONFIGURED' : !cacheReady ? 'CACHE_UNAVAILABLE' : blocked?.until > now() ? blocked.code : null};
  }
  return {station,health};
}
