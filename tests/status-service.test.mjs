import test from 'node:test';
import assert from 'node:assert/strict';
import {createStatusService,parseStation,sourceTime} from '../services/status-api/lib/status-service.js';
const now = Date.parse('2026-10-21T10:00:00Z');
const row = (id='01',extra={}) => ({statId:'NT100483',chgerId:id,zcode:'51',busiId:'NT',stat:'2',statUpdDt:'20200101090000',...extra});
const json = rows => JSON.stringify({resultCode:'00',pageNo:1,totalCount:rows.length,items:{item:rows}});
const registry = {collectedAt:'2026-10-21T00:00:00Z',stations:{NT100483:['51','NT']}};
const memoryCache = () => {
  const values = new Map(); return {get:async key=>values.get(key),set:async (key,value)=>values.set(key,value)};
};
const quiet = {error(){}};
test('full station JSON/XML preserve zero-prefixed identifiers and separate observation from state-change time',()=>{
  const stamp = new Date(now).toISOString();
  const data = parseStation(json([row(),row('02',{stat:'3'})]),'NT100483','51',stamp,'NT');
  assert.equal(data.chargers[0].id,'01'); assert.equal(data.chargers[0].observedAt,stamp);
  assert.equal(data.chargers[0].statusChangedAt,'2020-01-01T00:00:00.000Z');
  const xml = '<response><header><resultCode>00</resultCode><pageNo>1</pageNo><totalCount>1</totalCount></header><body><items><item><statId>NT100483</statId><chgerId>01</chgerId><zcode>51</zcode><busiId>NT</busiId><stat>2</stat></item></items></body></response>';
  assert.equal(parseStation(xml,'NT100483','51',stamp,'NT').chargers[0].id,'01');
  assert.equal(sourceTime('20260230010000'),null);
});
test('complete station snapshots reject missing/duplicate/mismatched pages, ignored filters and XML entities',()=>{
  for(const text of [json([row(),row()]),json([row('01',{statId:'OTHER'})]),json([row('01',{zcode:'11'})]),json([row('01',{busiId:'OTHER'})]),
    JSON.stringify({resultCode:'00',pageNo:1,totalCount:2,items:{item:[row()]}}),
    '<!DOCTYPE response [<!ENTITY bad "secret">]><response>&bad;</response>']) {
    assert.throws(()=>parseStation(text,'NT100483','51',new Date(now).toISOString(),'NT'));
  }
});
test('known station only, server-only key, shared cache and deduplication; cached hits retain upstream observation',async()=>{
  let clock = now, calls = 0;
  const cache = memoryCache();
  const fetcher = async url => {
    calls++; assert.equal(url.origin,'https://apis.data.go.kr');
    assert.equal(url.searchParams.get('statId'),'NT100483');
    assert.equal(url.searchParams.get('serviceKey'),'fixture+secret');
    return new Response(json([row()]));
  };
  const options = {cache,registry,serviceKey:'fixture%2Bsecret',fetcher,now:()=>clock,logger:quiet};
  const api = createStatusService(options);
  await assert.rejects(api.station('UNKNOWN','51'),{code:'NOT_FOUND'});assert.equal(calls,0);
  const [first,second] = await Promise.all([api.station('NT100483','51'),api.station('NT100483','51')]);
  assert.equal(calls,1);assert.equal(first.observedAt,second.observedAt);
  clock += 60000;
  const otherInstance = createStatusService(options);
  const cached = await otherInstance.station('NT100483','51');
  assert.equal(calls,1); assert.equal(cached.cached,true);assert.equal(cached.observedAt,first.observedAt);
  clock += 61000; await otherInstance.station('NT100483','51'); assert.equal(calls,2);
});
test('unconfigured/cache failure never spends calls; failed upstream keeps last success and exposes safe errors',async()=>{
  const cache = memoryCache(); let clock = now, calls = 0, fail = false;
  const api = createStatusService({cache,registry,serviceKey:'fixture-secret',now:()=>clock,logger:quiet,fetcher:async()=>{
    calls++; return fail ? new Response('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>22</returnReasonCode><errMsg>fixture-secret</errMsg></cmmMsgHeader></OpenAPI_ServiceResponse>',{status:403}) : new Response(json([row()]));
  }});
  const success = await api.station('NT100483','51');
  fail = true; clock += 121000;
  await assert.rejects(api.station('NT100483','51'),{code:'DAILY_LIMIT'});
  await assert.rejects(api.station('NT100483','51'),{code:'DAILY_LIMIT'}); assert.equal(calls,2);
  const health = await api.health();assert.equal(health.lastAttempt.status,'error');assert.equal(health.ready,false);
  assert.equal(health.lastSuccess.observedAt,success.observedAt);
  assert.doesNotMatch(JSON.stringify(health),/fixture-secret/);
  assert.equal((await cache.get('evchargingstation:status:v1:51:NT100483')).observedAt,success.observedAt);
  const absent = createStatusService({cache,registry,serviceKey:'',logger:quiet});
  assert.equal((await absent.health()).code,'UNCONFIGURED');
  await assert.rejects(absent.station('NT100483','51'),{code:'UNCONFIGURED'});
  const broken = createStatusService({cache:{get:async()=>{throw Error('private');}},registry,serviceKey:'fixture-secret',fetcher:async()=>{throw Error('must not call');}});
  await assert.rejects(broken.station('NT100483','51'),{code:'CACHE_UNAVAILABLE'});
});
