import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {packSearchStation,unpackSearchIndex} from '../public/js/national-search.js';
import {buildSearchIndex} from '../scripts/build-search-index.mjs';
import {DataClient} from '../public/js/data.js';
import {DEFAULT_FILTERS,filterStations,summarizeStation} from '../public/js/domain.js';
const now=Date.parse('2026-10-21T00:00:00Z');
const observedAt='2026-10-20T23:59:00Z';
const fixtures=[{id:'0001',regionCode:'11',name:'서울 시청',address:'서울특별시 중구',lat:37.56,lng:126.97,operatorId:'ME',operatorName:'공공',restricted:null,parkingFree:null,chargers:[{id:'01',type:'04',outputKw:100,status:'2',observedAt}]},
 {id:'NT100483',regionCode:'51',name:'철원역사문화공원',address:'강원특별자치도 철원군',lat:38.25,lng:127.21,operatorId:'NT',operatorName:'NICE인프라',restricted:false,parkingFree:false,useTime:'24시간 이용가능',phone:'not-needed-in-index',chargers:[{id:'01',type:'04',outputKw:100,status:'3',observedAt},{id:'02',type:'02',outputKw:7,status:'2',observedAt}]}];
const makeIndex=()=>({schemaVersion:1,kind:'station-search',fieldsVersion:1,totalStations:2,totalChargers:3,regions:[{regionCode:'11',complete:true},{regionCode:'51',complete:true}],stations:fixtures.map(packSearchStation)});

test('nationwide results find Cheorwon outside Seoul and preserve exact charger/access filter behavior',()=>{
 const data=unpackSearchIndex(makeIndex());
 const filters={...DEFAULT_FILTERS,query:'철원역사문화공원'};
 assert.deepEqual(filterStations(data.stations,data.regions,filters,new Set(),now).map(s=>s.id),['NT100483']);
 for(const patch of [{connector:'combo',available:true},{connector:'ac',available:true},{freeParking:true},{unrestricted:true},{open24:true},{minPower:100,available:true}]) {
  const f={...DEFAULT_FILTERS,...patch};
  assert.deepEqual(filterStations(data.stations,data.regions,f,new Set(),now).map(s=>s.id),filterStations(fixtures,data.regions,f,new Set(),now).map(s=>s.id));
 }
 assert.deepEqual(summarizeStation(data.stations[1],data.regions.get('51'),DEFAULT_FILTERS,now),summarizeStation(fixtures[1],data.regions.get('51'),DEFAULT_FILTERS,now));
 assert.equal(data.stations[0].id,'0001');
 assert.equal(data.stations[0].chargers[0].id,'01');
 assert.equal(data.stations[0].parkingFree,null);
 assert.equal(data.stations[0].restricted,null);
 assert.equal(data.stations[1].summaryOnly,true);
 assert.equal(data.stations[1].phone,undefined);
});

test('search decoding rejects mismatched totals, duplicate station IDs, missing regions and malformed equipment',()=>{
 for(const mutate of [d=>{d.totalStations=3;},d=>{d.totalChargers=4;},d=>{d.stations[1][0]='0001';},d=>{d.regions.pop();},d=>{d.stations[0][12][0].pop();}]) {
  const data=makeIndex();mutate(data);assert.throws(()=>unpackSearchIndex(data));
 }
 assert.throws(()=>unpackSearchIndex(makeIndex(),{stationCount:3}));
});

test('build derives a compressed national index from all verified regional snapshots and refuses incomplete totals',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'ev-national-'));t.after(()=>rm(temp,{recursive:true,force:true}));
 const prefix='releases/20261021T000000-abcdef0123/regions/';
 await mkdir(path.join(temp,prefix),{recursive:true});
 const manifest={schemaVersion:1,totalStations:2,totalChargers:3,regions:[]};
 for(const station of fixtures) {
  const filename=prefix+station.regionCode+'.json';
  const region={schemaVersion:1,regionCode:station.regionCode,complete:true,statusCoverageAt:observedAt,stations:[station]};
  await writeFile(path.join(temp,filename),JSON.stringify(region));
  manifest.regions.push({code:station.regionCode,path:filename,stationCount:1,chargerCount:station.chargers.length});
 }
 const entry=await buildSearchIndex(temp,manifest);
 assert.match(entry.path,/^search\/stations-[a-f0-9]{20}\.json.gz$/);
 assert.equal(entry.stationCount,2);assert.equal(entry.chargerCount,3);
 const decoded=JSON.parse(gunzipSync(await readFile(path.join(temp,entry.path))));
 assert.equal(unpackSearchIndex(decoded,entry).stations[1].name,'철원역사문화공원');
 assert.ok(entry.publishedBytes<entry.originalBytes);
 manifest.regions[0].stationCount=2;
 await assert.rejects(buildSearchIndex(temp,manifest),/counts/);
});

test('national search downloads are deduplicated and failed attempts remain retryable',async t=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'location');
 Object.defineProperty(globalThis,'location',{configurable:true,value:{href:'https://example.test/'}});
 t.after(()=>old?Object.defineProperty(globalThis,'location',old):delete globalThis.location);
 const client=new DataClient();let requests=0,complete;
 client.request=()=>{requests++;return new Promise(resolve=>{complete=resolve;});};
 const entry={path:'search/stations-0123456789abcdef0123.json.gz',stationCount:2,chargerCount:3};
 const a=client.nationwide(entry),b=client.nationwide(entry);
 assert.equal(requests,1);complete(makeIndex());assert.equal(await a,await b);
 await client.nationwide(entry);assert.equal(requests,1);
 client.searchCache=null;client.request=async()=>{requests++;throw new Error('offline');};
 await assert.rejects(client.nationwide(entry),/offline/);assert.equal(client.pendingSearch.size,0);
 client.request=async()=>makeIndex();assert.equal((await client.nationwide(entry)).stations.length,2);
});
