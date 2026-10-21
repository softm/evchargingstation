import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveStatusClient,mergeLiveStatus,validateLiveStatus} from '../public/js/live-status.js';
import {stationStatusCounts,statusSummaryHTML} from '../public/js/station-details.js';
const now = Date.parse('2026-10-21T10:00:00Z');
const old = '2026-10-21T08:00:00Z';
const stamp = new Date(now).toISOString();
const station = {id:'NT100483',regionCode:'51',name:'테스트 전용',chargers:[
  {id:'01',status:'2',observedAt:old,type:'04',outputKw:100},
  {id:'02',status:'3',observedAt:old,type:'02',outputKw:7},
  {id:'03',status:'2',observedAt:old,type:'02',outputKw:7}]};
const result = () => ({schemaVersion:1,kind:'station-status',stationId:station.id,regionCode:'51',observedAt:stamp,complete:true,
  chargers:[{id:'01',status:'3',observedAt:stamp,statusChangedAt:'2020-01-01T00:00:00Z'},{id:'02',status:'2',observedAt:stamp}]});

test('default browser fetch is invoked without binding the client as its native receiver',async t=>{
  globalThis.location={href:'https://softm.github.io/evchargingstation/'};
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=function() { assert.equal(this,undefined);return Promise.resolve(Response.json(result())); };
  const client=new LiveStatusClient({statusApiBaseUrl:'https://test.example/api'},{now:()=>now});
  const entry=await client.refresh(station);assert.equal(entry.error,'');assert.equal(entry.data.observedAt,stamp);
});

test('live overlay updates only matched chargers, preserves inventory and leaves missing records unconfirmed',()=>{
  const updated = mergeLiveStatus(station,validateLiveStatus(result(),station,now),{statusCoverageAt:old});
  assert.deepEqual(stationStatusCounts(updated,{},now),{available:1,charging:1,unavailable:0,unknown:1,total:3});
  assert.equal(updated.chargers[0].outputKw,100);
  assert.equal(updated.chargers[0].statusChangedAt,'2020-01-01T00:00:00Z');
  assert.equal(updated.chargers[2],station.chargers[2]);
  assert.equal(station.chargers[0].status,'2');
  assert.equal(mergeLiveStatus(station,result(),{statusCoverageAt:new Date(now+1000).toISOString()}),station);
});
test('wrong identity, duplicate chargers, partial responses, stale or future timestamps are rejected',()=>{
  for (const data of [{...result(),stationId:'OTHER'}, {...result(),regionCode:'11'}, {...result(),complete:false},
    {...result(),observedAt:old},{...result(),observedAt:new Date(now+120000).toISOString()},
    {...result(),chargers:[result().chargers[0],result().chargers[0]]}]) assert.throws(()=>validateLiveStatus(data,station,now));
});
test('deduplicated requests, cooldown and failed refresh never advance original observation time',async()=>{
  globalThis.location = {href:'https://softm.github.io/evchargingstation/'};
  let clock = now, calls = 0, failed = false;
  const client = new LiveStatusClient({statusApiBaseUrl:'https://api.example/api'},{now:()=>clock,fetcher:async url=>{
    calls++;
    assert.equal(new URL(url).searchParams.get('stationId'),'NT100483');
    assert.doesNotMatch(String(url),/serviceKey/i);
    return Response.json(failed ? {code:'DAILY_LIMIT'} : result(),{status:failed ? 503 : 200});
  }});
  await Promise.all([client.refresh(station),client.refresh(station)]);
  assert.equal(calls,1);
  await client.refresh(station); assert.equal(calls,1);
  failed = true; clock += 61000;
  await client.refresh(station);
  assert.equal(calls,2);
  assert.equal(client.state(station.id).data.observedAt,stamp);
  assert.match(client.state(station.id).error,/한도/);
  assert.equal(client.apply(station,{}).chargers[0].observedAt,stamp);
});
test('detail gives honest live loading/failure messages without presenting cached reads as new observations',()=>{
  const loading = statusSummaryHTML(station,{}, {now,liveStatus:{pending:true}});
  assert.match(loading,/disabled aria-busy="true"/);
  const failed = statusSummaryHTML(station,{}, {now,liveStatus:{error:'조회 실패'}});
  assert.match(failed,/조회 실패/); assert.match(failed,/최대 2분/);
  assert.equal(stationStatusCounts(station,{},now).unknown,3);
});
