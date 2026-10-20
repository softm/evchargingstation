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
