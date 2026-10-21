import {normalizeAdConfig,validAdUnit,validAdSize,UNIT_NAMES} from '../public/js/ads.js';
export const AD_VARIABLES = {PUBLIC_ADFIT_LIST_1_UNIT:'list1',PUBLIC_ADFIT_LIST_2_UNIT:'list2',PUBLIC_ADFIT_LIST_3_UNIT:'list3',PUBLIC_ADFIT_BOTTOM_DESKTOP_UNIT:'bottomDesktop',PUBLIC_ADFIT_BOTTOM_MOBILE_UNIT:'bottomMobile',PUBLIC_ADFIT_WELCOME_UNIT:'welcome'};
export function buildAdConfig(source,env = {}) {
  const config=normalizeAdConfig(source);
  for(const [variable,name] of Object.entries(AD_VARIABLES))if(env[variable])config.units[name].unit=env[variable].trim();
  if(env.PUBLIC_ADFIT_BANNER_UNIT&&!env.PUBLIC_ADFIT_LIST_1_UNIT)config.units.list1.unit=env.PUBLIC_ADFIT_BANNER_UNIT.trim();
  if(env.PUBLIC_ADFIT_ENABLED && !['true','false'].includes(env.PUBLIC_ADFIT_ENABLED))throw Error('PUBLIC_ADFIT_ENABLED must be true or false.');
  if(env.PUBLIC_ADFIT_ENABLED){config.enabled=env.PUBLIC_ADFIT_ENABLED==='true';config.mode=config.enabled?'adfit':'off';}
  else if(env.PUBLIC_ADFIT_BANNER_UNIT){config.enabled=true;config.mode='adfit';}
  const used=new Set();
  for(const name of UNIT_NAMES){const slot=config.units[name];
    if(!validAdSize(slot,name))throw Error(`Invalid AdFit creative dimensions: ${name}`);
    if(slot.unit&&!validAdUnit(slot.unit))throw Error(`Invalid issued AdFit unit: ${name}`);
    if(slot.unit&&used.has(slot.unit))throw Error(`AdFit units must be unique per placement: ${name}`);
    if(slot.unit)used.add(slot.unit);
  }
  // Legacy public field remains readable by older operations scripts.
  config.unit=config.units.list1.unit;
  return config;
}
