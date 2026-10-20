// SOFTM-DETAIL-GUIDE 날짜:20261021 : 공식 지도 상세의 정보 구조를 참고한 쉬운 안내.
import { chargerState, chargerSpeed, chargerMatches, typeInfo } from './domain.js';
import { chargerFee, feeLabel } from './fees.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
export const OUTPUT_TIERS = Object.freeze([
  {key:'slow',name:'완속',range:'30 kW 미만',kw:7},
  {key:'medium',name:'중속',range:'30~49 kW',kw:30},
  {key:'fast50',name:'급속',range:'50~99 kW',kw:50},
  {key:'fast100',name:'급속+',range:'100~199 kW',kw:100},
  {key:'ultra',name:'초급속',range:'200 kW 이상',kw:200},
]);

export function stationStatusCounts(station, region, now = Date.now(), threshold = 600) {
  const counts = {available:0,charging:0,unavailable:0,unknown:0,total:0};
  for (const charger of station.chargers || []) {
    const check = chargerState(charger, region, now, threshold);
    const key = !check.fresh ? 'unknown' : check.code === '2' ? 'available' : check.code === '3' ? 'charging'
      : ['4','5','6'].includes(check.code) ? 'unavailable' : 'unknown';
    counts[key]++;
    counts.total++;
  }
  return counts;
}

export function floorLabel(charger = {}) {
  const raw = String(charger.floorNumber ?? '').trim();
  const type = String(charger.floorType ?? '').trim().toUpperCase();
  if (!raw) return type === 'B' ? '지하 · 층수 미확인' : type === 'F' ? '지상 · 층수 미확인' : '';
  const basement = /^(?:B|지하)\s*(\d+)(?:층)?$/i.exec(raw) || /^-(\d+)$/.exec(raw);
  if (basement && Number(basement[1]) > 0) return `지하 ${Number(basement[1])}층`;
  const above = /^(?:F|지상)\s*(\d+)(?:층)?$/i.exec(raw);
  if (above && Number(above[1]) > 0) return `지상 ${Number(above[1])}층`;
  if (/^\d+(?:층)?$/.test(raw)) {
    const n = Number(raw.replace('층',''));
    if (n > 0) return type === 'B' ? `지하 ${n}층` : type === 'F' ? `지상 ${n}층` : `${n}층 · 지상/지하 미확인`;
  }
  return `층수 원문: ${raw}${type && !['F','B'].includes(type) ? ` (구분 ${type})` : ''}`;
}

export function stationFloors(station) {
  const floors = [...new Set((station.chargers || []).map(floorLabel).filter(Boolean))];
  if (floors.length) return floors.join(' · ');
  return station.floorNumbers ? `층수 원문: ${station.floorNumbers}` : '설치 층수 미확인';
}

export function chargerLocation(station, charger) {
  // Station-level locations can combine several different charger positions.
  // Never assign that combined text to an individual charger as an exact position.
  const own = String(charger.location || '').trim();
  const shared = String(station.location || '').trim();
  const location = own || (!shared.includes(' / ') ? shared : '');
  const floor = floorLabel(charger);
  return [...new Set([location, String(charger.detailAddress || '').trim(), floor].filter(Boolean))].join(' · ') || '충전기별 위치 미확인';
}

const hasChargerFilter = filters => Boolean(filters?.connector || filters?.speed || Number(filters?.minPower) > 0 || filters?.available);

export function statusSummaryHTML(station, region, {now = Date.now(), threshold = 600, filters = {}} = {}) {
  const c = stationStatusCounts(station, region, now, threshold);
  if (!c.total) return '<p class="detail-status-lead unknown"><strong>등록된 충전기 정보가 없어요</strong></p>';
  const filtered = hasChargerFilter(filters);
  // Availability is a result, not evidence that incompatible equipment is absent.
  // Keep unknown compatible chargers in this message even with the waiting filter on.
  const selected = filtered ? stationStatusCounts({chargers:(station.chargers || []).filter(charger => chargerMatches(charger,{...filters,available:false},region,now,threshold))},region,now,threshold) : c;
  const message = !selected.total ? '선택한 커넥터·출력에 맞는 충전기가 없어요'
    : selected.unknown === selected.total ? '현재 충전 상태를 확인할 수 없어요'
    : selected.available ? `최근 확인된 대기 충전기 ${selected.available}기`
    : selected.unknown ? '확인된 상태에서 대기 충전기가 없어요' : '최근 확인된 대기 충전기가 없어요';
  const items = [['available','충전 대기'],['charging','충전 중'],['unavailable','중지·점검·예약'],['unknown','확인 필요']];
  return `<div class="detail-status-lead ${selected.available ? 'available' : 'unknown'}"><span>${filtered ? `커넥터·출력 조건 일치 ${selected.total}기 / 전체 ${c.total}기` : `충전소 전체 ${c.total}기 기준`}${filters.available ? ` · 충전 대기 필터 일치 ${selected.available}기` : ''}</span><strong>${message}</strong>${selected.unknown ? `<small>${selected.total}기 중 ${selected.unknown}기는 현재 상태를 다시 확인해 주세요.</small>` : ''}</div>
    <p class="detail-status-scope">충전소 전체 ${c.total}기${filtered ? ' · 검색 조건 밖 충전기도 포함' : ''}</p>
    <div class="detail-status-grid" aria-label="충전소 전체 충전기 상태 요약">${items.map(([key,label]) => `<div class="detail-status ${key}${c[key] === 0 ? ' is-zero' : ''}"><span>${label}</span><strong>${c[key]}<small>기</small></strong></div>`).join('')}</div>
    <p class="detail-explanation">${Math.round(threshold / 60)}분 이내 확인한 상태만 집계하며 지연·통신 이상은 확인 필요로 표시합니다. 주차면 점유·대기 차량 정보는 제공되지 않습니다.</p>`;
}

export function stationFeeCoverage(catalog, station, {demo = false} = {}) {
  const chargers = station.chargers || [];
  const count = membership => demo ? 0 : chargers.filter(charger => chargerFee(catalog,station,charger,membership)).length;
  return {total:chargers.length, member:count('member'), nonmember:count('nonmember')};
}

function priceHTML(quote, label) {
  return `<div><dt>${label}</dt><dd>${quote ? `<strong>${esc(feeLabel(quote))}</strong><small>${quote.basis === 'official_tier' ? '공표 요금' : '공시 범위'}</small>` : '<span class="price-unknown">미확인</span>'}</dd></div>`;
}

export function chargerRowsHTML(station, region, catalog, {now = Date.now(), threshold = 600, demo = false, filters = {}, formatTime = value => value || '미확인'} = {}) {
  const time = value => esc(formatTime(value, true));
  const coverage = stationFeeCoverage(catalog,station,{demo});
  const hasStationPrices = coverage.member || coverage.nonmember;
  return (station.chargers || []).map(charger => {
    const check = chargerState(charger, region, now, threshold);
    const connector = typeInfo(charger.type);
    const tier = OUTPUT_TIERS.find(item => item.key === chargerSpeed(charger));
    const member = demo ? null : chargerFee(catalog, station, charger, 'member');
    const guest = demo ? null : chargerFee(catalog, station, charger, 'nonmember');
    const tone = !check.fresh || !['2','3','4','5','6'].includes(check.code) ? 'unknown'
      : check.available ? 'available' : check.code === '3' ? 'charging' : 'unavailable';
    const technical = [charger.manufacturer ? `제조사 ${charger.manufacturer}` : '',
      charger.installationYear ? `${charger.installationYear}년 설치` : '',
      charger.method ? `충전방식 ${charger.method}` : '', charger.powerType ? `전원 ${charger.powerType}` : ''].filter(Boolean);
    const currentStart = check.fresh && check.code === '3' && Number.isFinite(Date.parse(charger.currentStartedAt)) && Date.parse(charger.currentStartedAt) <= now;
    return `<article class="charger-detail" aria-label="${esc(charger.id)}번 충전기">
      <div class="charger-detail-heading"><h4>${esc(charger.id)}번 충전기</h4><span class="charger-status ${tone}">${esc(check.label)}</span></div>
      ${hasChargerFilter(filters) ? `<p class="charger-filter-match${chargerMatches(charger,filters,region,now,threshold) ? ' matches' : ''}">${chargerMatches(charger,filters,region,now,threshold) ? '현재 충전기 조건 일치' : '현재 충전기 조건 밖'}</p>` : ''}
      <p class="charger-connector">${esc(connector.name)}${connector.busOnly ? '<b class="bus-only">버스 전용</b>' : ''}</p>
      <div class="charger-spec"><strong>${tier ? `${tier.name} · ${esc(charger.outputKw)} kW` : '출력 미확인'}</strong><span>${tier ? tier.range : '출력 정보가 제공되지 않았습니다'}</span></div>
      <p class="charger-position">설치 위치 <strong>${esc(chargerLocation(station, charger))}</strong></p>
      ${member || guest ? `<dl class="charger-prices" aria-label="${esc(charger.id)}번 충전기 요금">${priceHTML(member,'회원')}${priceHTML(guest,'비회원')}</dl>` : hasStationPrices ? '<p class="charger-fee-missing">요금 자료 미확인</p>' : ''}
      <p class="charger-confirmed">상태 확인 <time>${check.confirmedAt !== null ? time(check.confirmedAt) : '시각 미제공'}</time>${!check.fresh ? `<br><span>마지막 보고: ${esc(check.sourceLabel)} · 현재 상태는 재확인 필요</span>` : ''}</p>
      <details class="charger-technical" data-detail-section="charger-${esc(charger.id)}"><summary>충전기 상세 기록</summary>
        ${technical.length ? `<p>${esc(technical.join(' · '))}</p>` : ''}<dl><dt>상태 변경 시각</dt><dd>${time(charger.statusChangedAt)}</dd>
        ${currentStart ? `<dt>현재 충전 시작</dt><dd>${time(charger.currentStartedAt)}</dd>` : ''}
        <dt>마지막 충전 시작</dt><dd>${time(charger.lastStartedAt)}</dd><dt>마지막 충전 종료</dt><dd>${time(charger.lastEndedAt)}</dd></dl>
        <p>상태 변경은 마지막으로 상태가 바뀐 시각입니다. 위의 상태 확인 시각과 구분해 보세요.</p></details>
    </article>`;
  }).join('') || '<p class="detail-explanation">등록된 충전기 정보가 없습니다.</p>';
}

export function chargingHelpHTML(threshold = 600) {
  return `<details class="charging-guide" data-detail-section="guide"><summary>충전 용어·요금 읽는 법</summary><dl>
    <dt>커넥터</dt><dd>차량 충전구와 맞는 단자입니다. DC콤보·AC완속·NACS 등 차량이 지원하는 규격을 확인하세요. 복합 커넥터도 충전기 1기로 셉니다.</dd>
    <dt>kW와 kWh</dt><dd>kW는 충전기의 출력, kWh는 충전한 전기량입니다. 실제 충전 속도는 차량·배터리 상태와 동시 사용에 따라 달라집니다.</dd>
    <dt>회원·비회원</dt><dd>표에 표시된 운영사 요금제 구분입니다. 다른 사업자 카드로 이용하는 로밍은 별도 단가·할인이 적용될 수 있습니다.</dd>
    <dt>요금 출처</dt><dd>공표 요금은 공개된 출력별 기준단가, 공시 범위는 여러 요금제의 참고 범위입니다. 이 앱에는 충전기별 실시간 결제단가가 연결되어 있지 않습니다. 미확인을 무료로 해석하지 마세요.</dd>
    <dt>예상 비용</dt><dd>충전량 × 단가로 계산합니다. 예를 들어 20 kWh × 350원/kWh = 7,000원이며 주차비는 별도입니다.</dd>
    <dt>상태 확인</dt><dd>수집에서 상태를 확인한 시각입니다. ${Math.round(threshold / 60)}분을 넘거나 통신이 원활하지 않으면 현재 충전 가능 여부를 다시 확인해야 합니다.</dd>
    <dt>주차·이용 제한</dt><dd>충전 요금과 주차 요금은 별도입니다. 입주민·직원 전용, 운영시간과 출입 조건도 함께 확인하세요.</dd>
    </dl></details>`;
}

export function tariffGuideHTML(catalog, station, {demo = false} = {}) {
  if (demo) return '';
  const coverage = stationFeeCoverage(catalog,station);
  const hasPrices = coverage.member || coverage.nonmember;
  const operator = catalog?.operators?.find(item => item.operatorId === String(station.operatorId).toUpperCase());
  const source = catalog?.mode === 'licensed_publisher' ? 'https://chargeinfo.ksga.org/front/fee/feeTable'
    : 'https://ev.or.kr/nportal/evcarInfo/initEvcarChargePriceV2.do';
  const reference = catalog?.operators?.find(item => item.operatorId === 'ME');
  const tiers = OUTPUT_TIERS.map(tier => ({...tier, quote:chargerFee(catalog,{operatorId:'ME'},{outputKw:tier.kw})}));
  const hasReference = String(station.operatorId).toUpperCase() === 'ME' && reference && tiers.every(tier => tier.quote?.basis === 'official_tier');
  return `<div class="tariff-guidance${hasPrices ? '' : ' tariff-unavailable'}"><p><strong>${hasPrices ? '확인된 참고 요금만 표시합니다.' : '이 충전소의 회원·비회원 요금은 아직 확인되지 않았습니다.'}</strong></p><p>${hasPrices ? `충전기 ${coverage.total}기 중 회원 요금 ${coverage.member}기 · 비회원 요금 ${coverage.nonmember}기의 자료가 연결되어 있습니다. 제공된 단가만 충전기 카드에 표시합니다.` : '충전기 카드에 가격이 없거나 미확인이어도 무료라는 뜻은 아닙니다.'}</p><p>운영사: ${esc(station.operatorName || '미확인')}${hasPrices ? ` · 요금표 갱신일 ${esc(operator?.updatedAt || '미확인')}` : ''}</p><p>충전기별 실시간 결제단가는 연결되어 있지 않습니다. 회원·할인·시간대·로밍과 현장 안내에 따라 실제 결제금액이 달라질 수 있습니다.</p><a class="official-fee" href="${source}" target="_blank" rel="noopener noreferrer">사업자별 공식 요금·로밍 안내 ↗</a></div>
    ${hasReference ? `<details class="charging-guide" data-detail-section="public-tariff"><summary>기후부 공공충전시설 회원 요금 기준표</summary><p>기후부 운영 공공충전시설의 공표 회원 요금입니다. 선택한 충전소의 운영사 요금과 구분해 참고하세요.</p><table class="reference-price-table"><caption>공공충전시설 출력별 공표 회원 요금 · 원/kWh</caption><thead><tr><th scope="col">출력 구분</th><th scope="col">요금</th></tr></thead><tbody>${tiers.map(tier => `<tr><th scope="row">${tier.name}<small>${tier.range}</small></th><td>${esc(feeLabel(tier.quote))}</td></tr>`).join('')}</tbody></table><p>요금표 갱신일 ${esc(reference.updatedAt || '미확인')} · <a href="https://ev.or.kr/nportal/evcarInfo/initEvcarChargePriceV2.do" target="_blank" rel="noopener noreferrer">공식 요금표</a></p></details>` : ''}`;
}
