import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stationStatusCounts, floorLabel, stationFloors, chargerLocation, chargerRowsHTML, statusSummaryHTML, tariffGuideHTML} from '../public/js/station-details.js';

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
  assert.match(statusSummaryHTML(station,{}, {now}),/3기는 현재 상태를 확인해 주세요/);
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
  assert.match(privateHtml,/연결된 요금 자료가 없습니다/);
  const missingPower=chargerRowsHTML({operatorId:'ME',chargers:[charger('2',{outputKw:null})]},{},catalog,{now});
  assert.doesNotMatch(missingPower,/348.4원/);
  assert.match(missingPower,/출력 미확인/);
  const guide=tariffGuideHTML(catalog,{operatorId:'NT',operatorName:'NICE인프라'});
  assert.match(guide,/기후부 운영 공공충전시설/);
  assert.match(guide,/운영사 요금과 구분/);
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
  assert.match(demo,/실제 요금 없음/);
});

test('old charging reports and future start timestamps are not presented as an ongoing session',()=>{
  for(const record of [charger('3',{observedAt:'2026-10-20T01:00:00Z',currentStartedAt:'2026-10-20T00:00:00Z'}),charger('3',{currentStartedAt:'2026-10-21T01:00:00Z'})]) {
    const html=chargerRowsHTML({chargers:[record]},{},null,{now});
    assert.doesNotMatch(html,/<dt>현재 충전 시작/);
  }
});
