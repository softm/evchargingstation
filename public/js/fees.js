/** Published tariff guidance, not a quote of a final checkout amount. */
export function chargerFee(catalog, station, charger, membership = 'member') {
  if (!catalog || !Array.isArray(catalog.operators) || !station?.operatorId || !charger) return null;
  if (!['member', 'nonmember'].includes(membership)) return null;
  const operator = catalog.operators.find(item => item.operatorId === String(station.operatorId).toUpperCase());
  const kw = Number(charger.outputKw);
  if (!operator || !Number.isFinite(kw) || kw <= 0) return null;
  const rates = (operator.rates || []).filter(rate => {
    if (rate.membership !== membership || !Number.isFinite(rate.minPrice) || !Number.isFinite(rate.maxPrice)) return false;
    if (rate.minKw !== undefined && rate.minKw !== null) {
      return kw >= rate.minKw && (rate.maxKwExclusive === null || rate.maxKwExclusive === undefined || kw < rate.maxKwExclusive);
    }
    // Publisher averages may only identify fast/slow, never assign 30-49kW by guess.
    return kw < 30 ? rate.kind === 'slow' : kw >= 50 ? rate.kind === 'fast' : false;
  });
  if (!rates.length) return null;
  return {
    min: Math.min(...rates.map(rate => rate.minPrice)),
    max: Math.max(...rates.map(rate => rate.maxPrice)),
    name: operator.name,
    updatedAt: operator.updatedAt || null,
    source: catalog.source?.url || null,
    basis: rates.length === 1 && rates[0].basis === 'official_output_tier' ? 'official_tier' : 'published_tariff_range',
  };
}

export function summarizeFees(catalog, station, membership = 'member') {
  const quotes = (station?.chargers || []).map(charger => chargerFee(catalog, station, charger, membership)).filter(Boolean);
  if (!quotes.length) return null;
  return { ...quotes[0], min: Math.min(...quotes.map(q => q.min)), max: Math.max(...quotes.map(q => q.max)),
    matchedChargers: quotes.length, totalChargers: (station.chargers || []).length };
}

export function feeLabel(fee) {
  if (!fee) return '요금 정보 미확인';
  const format = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  const value = fee.min === fee.max ? format(fee.min) : `${format(fee.min)}~${format(fee.max)}`;
  return `${value}원/kWh`;
}

const FACILITY_TYPES = Object.freeze({
  A0: '공공시설', B0: '주차시설', C0: '휴게시설', D0: '관광시설', E0: '상업시설',
  F0: '차량정비시설', G0: '기타시설', H0: '공동주택시설', I0: '근린생활시설',
  J0: '교육문화시설',
});
export function facilityName(station) {
  const kind = String(station?.facilityKind || '').toUpperCase();
  if (!kind) return '시설 구분 미확인';
  return FACILITY_TYPES[kind] || `시설 코드 ${kind}`;
}

/** KECO EvCharger OpenAPI facility detail codes; unknown new codes stay visible. */
const FACILITY_DETAILS = Object.freeze({
  A001:'관공서', A002:'주민센터', A003:'공공기관', A004:'지자체시설',
  B001:'공영주차장', B002:'공원주차장', B003:'환승주차장', B004:'일반주차장',
  C001:'고속도로 휴게소', C002:'지방도로 휴게소', C003:'쉼터',
  D001:'공원', D002:'전시관', D003:'민속마을', D004:'생태공원', D005:'홍보관', D006:'관광안내소', D007:'관광지', D008:'박물관', D009:'유적지',
  E001:'마트·쇼핑몰', E002:'백화점', E003:'숙박시설', E004:'골프장', E005:'카페', E006:'음식점', E007:'주유소', E008:'영화관',
  F001:'서비스센터', F002:'정비소',
  G001:'군부대', G002:'야영장', G003:'공중전화부스', G004:'기타', G005:'오피스텔', G006:'단독주택',
  H001:'아파트', H002:'빌라', H003:'사업장·사옥', H004:'기숙사', H005:'연립주택',
  I001:'병원', I002:'종교시설', I003:'보건소', I004:'경찰서', I005:'도서관', I006:'복지관', I007:'수련원', I008:'금융기관',
  J001:'학교', J002:'교육원', J003:'학원', J004:'공연장', J005:'관람장', J006:'동식물원', J007:'경기장',
});
export function facilityDetailName(station) {
  const code = String(station?.facilityDetailCode || '').toUpperCase();
  if (!code) return '';
  return FACILITY_DETAILS[code] || `상세 코드 ${code}`;
}
