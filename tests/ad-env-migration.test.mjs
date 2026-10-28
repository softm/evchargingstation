import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMigratedAdEnvironment,buildAdConfig} from '../scripts/ad-config.mjs';
const source={enabled:true,mode:'adfit',units:{
 list1:{unit:'DAN-TEST_LIST_001',width:300,height:250},
 list2:{unit:'',width:320,height:100},
 list3:{unit:'DAN-TEST_LIST_003',width:320,height:100},
 bottomDesktop:{unit:'',width:728,height:90},
 bottomMobile:{unit:'',width:320,height:100},
 welcome:{unit:'',width:320,height:100}
}};
test('documented relocation clears only the stale empty-mobile override',()=>{
 const input={PUBLIC_ADFIT_BOTTOM_MOBILE_UNIT:'DAN-TEST_LIST_003',PUBLIC_ADFIT_ENABLED:'true'};
 const result=normalizeMigratedAdEnvironment(source,input);
 assert.equal(result.migrated,true);assert.equal(result.env.PUBLIC_ADFIT_BOTTOM_MOBILE_UNIT,undefined);
 assert.equal(input.PUBLIC_ADFIT_BOTTOM_MOBILE_UNIT,'DAN-TEST_LIST_003');
 const config=buildAdConfig(source,result.env);
 assert.equal(config.units.list3.unit,'DAN-TEST_LIST_003');assert.equal(config.units.bottomMobile.unit,'');
});
test('a separately issued mobile unit is retained',()=>{
 const result=normalizeMigratedAdEnvironment(source,{PUBLIC_ADFIT_BOTTOM_MOBILE_UNIT:'DAN-TEST_MOBILE_01'});
 assert.equal(result.migrated,false);assert.equal(buildAdConfig(source,result.env).units.bottomMobile.unit,'DAN-TEST_MOBILE_01');
});
test('genuine duplicate configuration remains a build error',()=>{
 const configured=structuredClone(source);configured.units.bottomMobile.unit='DAN-TEST_MOBILE_01';
 const result=normalizeMigratedAdEnvironment(configured,{PUBLIC_ADFIT_BOTTOM_MOBILE_UNIT:'DAN-TEST_LIST_003'});
 assert.equal(result.migrated,false);assert.throws(()=>buildAdConfig(configured,result.env),/unique per placement/);
});
test('relocation handling does not discard an otherwise unique pair of explicit overrides',()=>{
 const result=normalizeMigratedAdEnvironment(source,{PUBLIC_ADFIT_BOTTOM_MOBILE_UNIT:'DAN-TEST_LIST_003',PUBLIC_ADFIT_LIST_3_UNIT:'DAN-TEST_OTHER_03'});
 assert.equal(result.migrated,false);assert.equal(buildAdConfig(source,result.env).units.bottomMobile.unit,'DAN-TEST_LIST_003');
});
