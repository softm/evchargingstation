import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FILTERS, chargerSpeed, chargerMatches, operatorKey, isOpen24, filterStations, summarizeStation } from '../public/js/domain.js';
import { nearbyAlternatives, compareStations, estimateChargingCost } from '../public/js/discovery.js';

const now = Date.parse('2026-10-20T12:00:00Z');
const charger = overrides => ({id:'01',type:'04',outputKw:100,status:'2',observedAt:'2026-10-20T11:59:00Z',...overrides});
const station = overrides => ({id:'A',name:'충전소',lat:37.5665,lng:126.978,regionCode:'11',operatorId:'ME',operatorName:'공공',useTime:'24시간 이용가능',restricted:false,parkingFree:true,chargers:[charger()],...overrides});

test('speed tiers use documented power boundaries and never guess unknown output', () => {
  for (const [power,speed] of [[7,'slow'],[29.9,'slow'],[30,'medium'],[49.9,'medium'],[50,'fast50'],[99.9,'fast50'],[100,'fast100'],[199.9,'fast100'],[200,'ultra']]) assert.equal(chargerSpeed({outputKw:power}),speed);
  for (const power of [null,undefined,NaN,0,'200']) assert.equal(chargerSpeed({outputKw:power}),'');
});

test('connector, speed, minimum power and availability all match one charger', () => {
  const mixed = station({chargers:[charger({type:'02',outputKw:7}),charger({id:'02',outputKw:200,status:'3'})]});
  const filters = {...DEFAULT_FILTERS,connector:'combo',speed:'ultra',minPower:200,available:true};
  assert.equal(filterStations([mixed],{},filters,new Set(),now).length,0);
  assert.equal(chargerMatches(mixed.chargers[0],filters,{},now),false);
  mixed.chargers[1].status='2';
  assert.equal(filterStations([mixed],{},filters,new Set(),now).length,1);
  assert.equal(summarizeStation(mixed,{},filters,now).matching,1);
});

test('operator identity and explicit 24-hour schedules preserve unknown access', () => {
  assert.equal(operatorKey(station()),'id:ME');
  assert.equal(isOpen24(station()),true);
  for (const useTime of ['',null,'24시간 (평일만)','09:00~18:00','24시간, 주말 출입 불가']) assert.equal(isOpen24(station({useTime})),false);
  assert.equal(filterStations([station()],{},{operator:'id:XX'},new Set(),now).length,0);
  assert.equal(filterStations([station({useTime:''})],{},{open24:true},new Set(),now).length,0);
});

test('nearby alternatives enforce distance, identity, vehicle/access filters and fresh availability', () => {
  const origin=station();
  const candidates=[origin,station({id:'B',name:'인근',lng:126.979}),station({id:'B',name:'중복',lng:126.979}),station({id:'C',chargers:[charger({type:'02',outputKw:7})]}),station({id:'D',lat:35}),station({id:'E',restricted:true}),station({id:'F',lat:null}),station({id:'G',chargers:[charger({observedAt:'2026-10-20T10:00:00Z'})]})];
  const result=nearbyAlternatives(origin,candidates,{}, {...DEFAULT_FILTERS,query:'기존 이름',connector:'combo',available:true,unrestricted:true},now);
  assert.deepEqual(result.map(x=>x.id),['B']);
  assert.deepEqual(nearbyAlternatives({...origin,lat:null},candidates,{},DEFAULT_FILTERS,now),[]);
});

test('count sorting uses compatible chargers, power sorting respects matching output', () => {
  const a=station({id:'A',name:'A'}), b=station({id:'B',name:'B'});
  const summaries=new Map([['A',{total:10,matching:1,maxPower:200}],['B',{total:2,matching:2,maxPower:100}]]);
  assert.equal([a,b].sort((x,y)=>compareStations(x,y,'count',summaries,a))[0].id,'B');
  assert.equal([b,a].sort((x,y)=>compareStations(x,y,'power',summaries,a))[0].id,'A');
});

test('cost estimates require explicit positive inputs and round to a whole won', () => {
  assert.equal(estimateChargingCost('20','348.4'),6968);
  assert.equal(estimateChargingCost('10.5','325.6'),3419);
  for (const pair of [['20',''],['20','0'],['-1','300'],['20','Infinity'],['2000','300']]) assert.equal(estimateChargingCost(...pair),null);
});
