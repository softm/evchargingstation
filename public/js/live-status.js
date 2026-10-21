// A status overlay never replaces inventory, connector, price or location data.
export const statusMessage = code => ({
  UNCONFIGURED:'직접 상태 조회가 아직 연결되지 않았습니다. 마지막 확인 정보를 표시합니다.',
  DAILY_LIMIT:'오늘의 상태 조회 한도에 도달했습니다. 마지막 확인 정보를 표시합니다.',
  RATE_LIMIT:'상태 조회 요청이 많습니다. 잠시 후 다시 확인해 주세요.',
  BUSY:'상태 조회 요청이 많습니다. 잠시 후 다시 확인해 주세요.',
  INSTANCE_LIMIT:'상태 조회 요청이 많습니다. 잠시 후 다시 확인해 주세요.',
  NOT_FOUND:'직접 조회에서 이 충전소를 확인하지 못했습니다. 마지막 확인 정보를 표시합니다.',
}[code] || '현재 상태를 다시 확인하지 못했습니다. 마지막 상태와 원래 확인 시각을 유지합니다.');

export function validateLiveStatus(data, station, now = Date.now()) {
  const observed = Date.parse(data?.observedAt);
  if (data?.schemaVersion !== 1 || data.kind !== 'station-status' || data.complete !== true
    || data.stationId !== station.id || data.regionCode !== station.regionCode
    || !Number.isFinite(observed) || observed > now+60000 || now-observed > 600000
    || !Array.isArray(data.chargers) || !data.chargers.length) throw new Error('INVALID_RESPONSE');
  const ids = new Set();
  for (const row of data.chargers) {
    if (typeof row.id !== 'string' || !row.id || ids.has(row.id) || row.observedAt !== data.observedAt || !/^[0-6]$|^9$/.test(row.status)) throw new Error('INVALID_RESPONSE');
    ids.add(row.id);
  }
  return data;
}

export function mergeLiveStatus(station, data, region) {
  if (!data || data.stationId !== station.id || data.regionCode !== station.regionCode) return station;
  const rows = new Map(data.chargers.map(row=>[row.id,row]));
  let changed = false;
  const chargers = station.chargers.map(charger => {
    const row = rows.get(charger.id);
    const base = Math.max(Date.parse(charger.observedAt)||0, region?.complete !== false ? Date.parse(region?.statusCoverageAt)||0 : 0);
    if (!row || Date.parse(row.observedAt) <= base) return charger;
    changed = true;
    return {...charger,status:row.status,observedAt:row.observedAt,statusChangedAt:row.statusChangedAt,
      lastStartedAt:row.lastStartedAt,lastEndedAt:row.lastEndedAt,currentStartedAt:row.currentStartedAt};
  });
  return changed ? {...station,chargers} : station;
}

export class LiveStatusClient {
  constructor(config = {}, {fetcher = fetch, now = Date.now} = {}) {
    this.base = config.statusApiBaseUrl ? new URL(`${config.statusApiBaseUrl.replace(/\/$/,'')}/`,location.href) : null;
    if (this.base && !['https:','http:'].includes(this.base.protocol)) throw new Error('Invalid status server URL');
    this.fetcher = fetcher; this.now = now; this.entries = new Map(); this.pending = new Map();
  }
  get enabled() { return Boolean(this.base); }
  state(id) { return this.entries.get(id) || {}; }
  apply(station,region) { return mergeLiveStatus(station,this.entries.get(station.id)?.data,region); }
  async health() {
    if (!this.enabled) return {configured:false,code:'URL_UNCONFIGURED'};
    const response = await this.fetcher(new URL('health',this.base),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('STATUS_SERVER_UNAVAILABLE');
    const data = await response.json();
    if (data.schemaVersion !== 1 || data.kind !== 'status-api-health') throw new Error('INVALID_RESPONSE');
    return data;
  }
  async refresh(station) {
    if (!this.enabled) return;
    if (this.pending.has(station.id)) return this.pending.get(station.id);
    const previous = this.state(station.id);
    // Manual checks share the same cooldown, so repeated clicks cannot bypass it.
    if (previous.retryAt > this.now()) return previous;
    this.entries.set(station.id,{...previous,pending:true});
    const task = (async () => {
      try {
        const url = new URL('status',this.base);
        url.search = new URLSearchParams({stationId:station.id,region:station.regionCode});
        const response = await this.fetcher(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(16000),headers:{Accept:'application/json'}});
        const data = await response.json();
        if (!response.ok) { const error = new Error('STATUS_UNAVAILABLE'); error.code = data.code; error.retryAfterSeconds = data.retryAfterSeconds; throw error; }
        validateLiveStatus(data,station,this.now());
        const current = this.state(station.id);
        const newest = Date.parse(current.data?.observedAt) > Date.parse(data.observedAt) ? current.data : data;
        const entry = {data:newest,pending:false,error:'',retryAt:this.now()+60000};
        this.entries.set(station.id,entry); return entry;
      } catch (error) {
        const entry = {...previous,pending:false,error:statusMessage(error.code),retryAt:this.now()+Math.min(300,Math.max(60,Number(error.retryAfterSeconds)||60))*1000};
        this.entries.set(station.id,entry); return entry;
      }
    })();
    this.pending.set(station.id,task);
    try { return await task; } finally {
      this.pending.delete(station.id);
      // Do not retain an unbounded set of visited station snapshots.
      while (this.entries.size > 200) {
        const id = [...this.entries.keys()].find(key=>!this.pending.has(key));
        if (!id) break; this.entries.delete(id);
      }
    }
  }
}
