import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stationStatusCounts, floorLabel, stationFloors, chargerLocation, chargerRowsHTML, statusSummaryHTML, tariffGuideHTML, stationFeeCoverage} from '../public/js/station-details.js';

const now = Date.parse('2026-10-21T00:00:00Z');
const observedAt = '2026-10-20T23:59:00Z';
const catalog = JSON.parse(await readFile(new URL('../public/data/fees.json',import.meta.url),'utf8'));
const charger = (status,extra={}) => ({id:'01',type:'04',outputKw:100,status,observedAt,...extra});

test('station overview partitions chargers once and never counts stale, reserved or undefined states as available',()=>{
  const station={chargers:['2','3','4','5','6','1','99'].map(status=>charger(status))};
  station.chargers.push(charger('2',{observedAt:'2026-10-20T00:00:00Z'}));
  assert.deepEqual(stationStatusCounts(station,{},now),{available:1,charging:1,unavailable:3,unknown:3,total:8});
  assert.deepEqual(stationStatusCounts(station,{complete:false,statusCoverageAt:observedAt},now),{available:1,charging:1,unavailable:3,unknown:3,total:8});
  assert.equal(stationStatusCounts({chargers:[charger('2',{observedAt:null,statusChangedAt:observedAt})]}, {},now).unknown,1);
  assert.equal(stationStatusCounts({chargers:[charger('2',{observedAt:'2026-10-21T01:00:00Z'})]}, {},now).available,0);
  assert.match(statusSummaryHTML(station,{}, {now}),/3기는 현재 상태를 다시 확인해 주세요/);
});

test('status copy distinguishes unknown availability, confirmed zero, partial uncertainty and an empty inventory',()=>{
  const html = chargers => statusSummaryHTML({chargers},{},{now});
  assert.match(html([charger('2',{observedAt:null})]),/현재 충전 상태를 확인할 수 없어요/);
  assert.match(html([charger('3')]),/최근 확인된 대기 충전기가 없어요/);
  const partial=html([charger('3'),charger('1')]);
  assert.match(partial,/확인된 상태에서 대기 충전기가 없어요/);
  assert.match(partial,/2기 중 1기는 현재 상태를 다시 확인/);
  assert.match(html([charger('2')]),/최근 확인된 대기 충전기 1기/);
  assert.match(html([]),/등록된 충전기 정보가 없어요/);
  assert.doesNotMatch(html([]),/detail-status-grid/);
});

test('a mixed-connector station states the selected scope and does not advertise an AC charger as waiting for DC',()=>{
  const station={chargers:[charger('3'),charger('2',{id:'02',type:'02',outputKw:7})]};
  const filters={connector:'combo'};
  const html=statusSummaryHTML(station,{},{now,filters});
  assert.match(html,/커넥터·출력 조건 일치 1기 \/ 전체 2기/);
  assert.match(html,/최근 확인된 대기 충전기가 없어요/);
  assert.match(html,/충전소 전체 2기 · 검색 조건 밖 충전기도 포함/);
  assert.doesNotMatch(html,/최근 확인된 대기 충전기 1기/);
  const rows=chargerRowsHTML(station,{},null,{now,filters});
  assert.equal((rows.match(/현재 충전기 조건 일치/g)||[]).length,1);
  assert.equal((rows.match(/현재 충전기 조건 밖/g)||[]).length,1);
  assert.match(statusSummaryHTML(station,{},{now,filters:{connector:'combo',available:true}}),/최근 확인된 대기 충전기가 없어요/);
});

test('the waiting filter cannot hide uncertainty or turn an unknown compatible charger into absent equipment',()=>{
  const station={chargers:[charger('2',{observedAt:null})]};
  const html=statusSummaryHTML(station,{},{now,filters:{connector:'combo',available:true}});
  assert.match(html,/커넥터·출력 조건 일치 1기/);
  assert.match(html,/충전 대기 필터 일치 0기/);
  assert.match(html,/현재 충전 상태를 확인할 수 없어요/);
  assert.doesNotMatch(html,/맞는 충전기가 없어요/);
  assert.match(statusSummaryHTML(station,{},{now,filters:{connector:'ac',available:true}}),/선택한 커넥터·출력에 맞는 충전기가 없어요/);
});

test('charger floors are readable while missing, zero and future type codes stay explicit',()=>{
  assert.equal(floorLabel({floorNumber:'1',floorType:'F'}),'지상 1층');
  assert.equal(floorLabel({floorNumber:'2',floorType:'B'}),'지하 2층');
  assert.equal(floorLabel({floorNumber:'B3'}),'지하 3층');
  assert.equal(floorLabel({floorNumber:'-2'}),'지하 2층');
  assert.equal(floorLabel({floorNumber:'2',floorType:'Z'}),'2층 · 지상/지하 미확인');
  assert.equal(floorLabel({floorNumber:'0',floorType:'F'}),'층수 원문: 0');
  assert.equal(floorLabel({}), '');
  assert.equal(stationFloors({chargers:[{floorType:'B',floorNumber:'2'},{floorType:'F',floorNumber:'1'}]}),'지하 2층 · 지상 1층');
});

test('a combined station position is not assigned to each charger; individual locations take precedence',()=>{
  const station={location:'동관 / 서관'};
  assert.equal(chargerLocation(station,{floorNumber:'B2'}),'지하 2층');
  assert.equal(chargerLocation(station,{}),'충전기별 위치 미확인');
  assert.equal(chargerLocation(station,{location:'동관',floorNumber:'B2'}),'동관 · 지하 2층');
  assert.equal(chargerLocation(station,{location:'동관',detailAddress:'A구역',floorNumber:'B2'}),'동관 · A구역 · 지하 2층');
  assert.equal(chargerLocation({location:'지상주차장'},{floorType:'F',floorNumber:'1'}),'지상주차장 · 지상 1층');
});

test('member and nonmember prices are separate; public prices are never assigned to a private operator',()=>{
  const html=chargerRowsHTML({operatorId:'ME',chargers:[charger('2')]},{},catalog,{now});
  assert.match(html,/348.4원\/kWh/);
  assert.match(html,/<dt>비회원<\/dt><dd><span class="price-unknown">미확인/);
  assert.match(html,/공표 요금/);
  const privateHtml=chargerRowsHTML({operatorId:'NT',chargers:[charger('2')]},{},catalog,{now});
  assert.doesNotMatch(privateHtml,/348.4원/);
  assert.doesNotMatch(privateHtml,/charger-prices|price-unknown/);
  const missingPower=chargerRowsHTML({operatorId:'ME',chargers:[charger('2',{outputKw:null})]},{},catalog,{now});
  assert.doesNotMatch(missingPower,/348.4원/);
  assert.match(missingPower,/출력 미확인/);
  const guide=tariffGuideHTML(catalog,{operatorId:'NT',operatorName:'NICE인프라'});
  assert.match(guide,/이 충전소의 회원·비회원 요금은 아직 확인되지 않았습니다/);
  assert.doesNotMatch(guide,/위에서 확인|reference-price-table|348.4원/);
  assert.match(tariffGuideHTML(catalog,{operatorId:'ME',chargers:[charger('2')]}),/기후부 운영 공공충전시설/);
});

test('fee coverage counts only matching operator, power and membership and reports partial coverage honestly',()=>{
  const station={operatorId:'ME',chargers:[charger('2'),charger('2',{id:'02',outputKw:null})]};
  assert.deepEqual(stationFeeCoverage(catalog,station),{total:2,member:1,nonmember:0});
  assert.deepEqual(stationFeeCoverage(catalog,{...station,operatorId:'NT'}),{total:2,member:0,nonmember:0});
  assert.deepEqual(stationFeeCoverage(catalog,station,{demo:true}),{total:2,member:0,nonmember:0});
  const guide=tariffGuideHTML(catalog,station);
  assert.match(guide,/충전기 2기 중 회원 요금 1기 · 비회원 요금 0기/);
  assert.match(guide,/실시간 결제단가는 연결되어 있지 않습니다/);
  assert.doesNotMatch(guide,/회원·비회원 요금은 아직 확인되지/);
  const rows=chargerRowsHTML(station,{},catalog,{now});
  assert.equal((rows.match(/요금 자료 미확인/g)||[]).length,1);
  assert.match(tariffGuideHTML(null,station),/회원·비회원 요금은 아직 확인되지/);
});

test('all upstream charger metadata is escaped, IDs preserve leading zeros, and demo never displays a real tariff',()=>{
  const station={operatorId:'ME',location:'<img onerror="x">',chargers:[charger('3',{id:'001" onclick="x',manufacturer:'<script>x</script>',currentStartedAt:'2026-10-20T23:50:00Z'})]};
  const html=chargerRowsHTML(station,{},catalog,{now});
  assert.match(html,/001&quot; onclick=&quot;x번 충전기/);
  assert.doesNotMatch(html,/<script>|<img onerror/);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/현재 충전 시작/);
  const demo=chargerRowsHTML(station,{},catalog,{now,demo:true});
  assert.doesNotMatch(demo,/348.4원/);
  assert.doesNotMatch(demo,/charger-prices/);
});

test('old charging reports and future start timestamps are not presented as an ongoing session',()=>{
  for(const record of [charger('3',{observedAt:'2026-10-20T01:00:00Z',currentStartedAt:'2026-10-20T00:00:00Z'}),charger('3',{currentStartedAt:'2026-10-21T01:00:00Z'})]) {
    const html=chargerRowsHTML({chargers:[record]},{},null,{now});
    assert.doesNotMatch(html,/<dt>현재 충전 시작/);
  }
});
