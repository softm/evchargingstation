import test from 'node:test';
import assert from 'node:assert/strict';
import {chargerFee, feeLabel, summarizeFees, facilityName} from '../public/js/fees.js';

const fees = { schemaVersion: 1, source: {url:'https://ev.or.kr/'}, operators: [
  {operatorId:'ME',name:'공공',rates:[
    {kind:'slow',membership:'member',minKw:0,maxKwExclusive:30,minPrice:295,maxPrice:295,basis:'official_output_tier'},
    {kind:'medium',membership:'member',minKw:30,maxKwExclusive:50,minPrice:307.2,maxPrice:307.2,basis:'official_output_tier'},
    {kind:'fast',membership:'member',minKw:50,maxKwExclusive:100,minPrice:325.6,maxPrice:325.6,basis:'official_output_tier'},
    {kind:'fast',membership:'member',minKw:100,maxKwExclusive:200,minPrice:348.4,maxPrice:348.4,basis:'official_output_tier'},
    {kind:'fast',membership:'member',minKw:200,maxKwExclusive:null,minPrice:393.1,maxPrice:393.1,basis:'official_output_tier'}
  ]}
]};
const station = {operatorId:'ME', chargers:[{outputKw:7},{outputKw:100},{outputKw:300}]};

test('published public tariffs match exact output tiers only',()=>{
  assert.equal(chargerFee(fees, station, {outputKw:29.9}).min,295);
  assert.equal(chargerFee(fees, station, {outputKw:30}).min,307.2);
  assert.equal(chargerFee(fees, station, {outputKw:50}).min,325.6);
  assert.equal(chargerFee(fees, station, {outputKw:100}).min,348.4);
  assert.equal(chargerFee(fees, station, {outputKw:200}).min,393.1);
  assert.equal(chargerFee(fees, station, {outputKw:7},'nonmember'),null);
  assert.equal(chargerFee(fees, {operatorId:'DIFFERENT'}, {outputKw:100}),null);
  assert.equal(chargerFee(fees, station, {outputKw:null}),null);
  assert.equal(feeLabel(summarizeFees(fees,station)), '295~393.1원/kWh');
});

test('published tariff average does not turn unknown middle-speed range into a fabricated rate',()=>{
  const data={operators:[{operatorId:'AA',rates:[
    {kind:'fast',membership:'member',minPrice:330,maxPrice:330,basis:'published_tariff_average'},
    {kind:'fast',membership:'member',minPrice:410,maxPrice:410,basis:'published_tariff_average'}
  ]}]};
  assert.equal(chargerFee(data,{operatorId:'AA'},{outputKw:49}),null);
  assert.equal(feeLabel(chargerFee(data,{operatorId:'AA'},{outputKw:100})), '330~410원/kWh');
  assert.equal(facilityName({facilityKind:'A0'}),'공공시설');
  assert.equal(facilityName({facilityKind:'xx'}),'시설 코드 XX');
});
