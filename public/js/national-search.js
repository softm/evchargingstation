// Compact, build-generated search snapshot. Detailed records are loaded on selection.
const FIELDS = ['id','regionCode','name','address','detailAddress','lat','lng','operatorId','operatorName','useTime','restricted','parkingFree'];
export function packSearchStation(station) {
  return [...FIELDS.map(key => station[key] ?? null), (station.chargers || []).map(charger =>
    [String(charger.id),String(charger.type ?? '').padStart(2,'0'),charger.outputKw ?? null,String(charger.status ?? '0'),charger.observedAt || null])];
}

export function unpackSearchIndex(data, expected = {}) {
  if (data?.schemaVersion !== 1 || data.kind !== 'station-search' || data.fieldsVersion !== 1
    || !Array.isArray(data.stations) || !Array.isArray(data.regions)
    || data.totalStations !== data.stations.length
    || (expected.stationCount !== undefined && expected.stationCount !== data.totalStations)
    || (expected.chargerCount !== undefined && expected.chargerCount !== data.totalChargers)) {
    throw new Error('전국 검색 자료의 형식·건수가 올바르지 않습니다. 새로고침해 주세요.');
  }
  const regions = new Map(data.regions.map(region => [String(region.regionCode),region]));
  const ids = new Set();
  const timestamps = new Map();
  const internTime = value => { if (!value) return null; if (!timestamps.has(value)) timestamps.set(value,value); return timestamps.get(value); };
  let chargerCount = 0;
  const stations = data.stations.map(row => {
    if (!Array.isArray(row) || row.length !== FIELDS.length + 1 || !Array.isArray(row[FIELDS.length])) throw new Error('전국 충전소 검색 자료를 확인할 수 없습니다.');
    const station = Object.fromEntries(FIELDS.map((key,index) => [key,row[index]]));
    station.id = String(station.id);
    station.regionCode = String(station.regionCode);
    if (!station.id || ids.has(station.id) || !regions.has(station.regionCode)) throw new Error('전국 검색 자료에 중복 또는 잘못된 지역이 있습니다.');
    ids.add(station.id);
    station.chargers = row[FIELDS.length].map(charger => {
      if (!Array.isArray(charger) || charger.length !== 5) throw new Error('전국 충전기 검색 자료를 확인할 수 없습니다.');
      return {id:String(charger[0]),type:String(charger[1]),outputKw:charger[2],status:String(charger[3]),observedAt:internTime(charger[4])};
    });
    chargerCount += station.chargers.length;
    station.summaryOnly = true;
    return station;
  });
  if (chargerCount !== data.totalChargers) throw new Error('전국 검색 자료의 충전기 건수가 일치하지 않습니다.');
  return {stations,regions};
}
