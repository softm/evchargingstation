import {validAdUnit,validAdSize} from './ads.js';
export const BOTTOM_STORAGE_KEY='evchargingstation:ad-bottom:expanded:v1';
export function bottomExpanded({stored,mobile,config,preview}) {
  const preferred=stored===null ? mobile ? config.mobileDefaultExpanded : config.desktopDefaultExpanded : stored==='true';
  // A first-time real banner is manual-only even if desktop preview defaults open.
  return Boolean(preferred && (preview || stored==='true'));
}
export function mountBottomAd({host,manager,win=window,doc=document,onSpaceChange=()=>{}}) {
  const config=manager.config.placements.bottomAnchor,button=host.querySelector('button'),panel=host.querySelector('.ad-bottom-panel');
  const key=BOTTOM_STORAGE_KEY+(manager.preview?':preview':'');
  let stored=null;try{stored=win.sessionStorage.getItem(key);}catch{}
  const desktop=win.matchMedia('(min-width:761px)');
  let expanded=bottomExpanded({stored,mobile:!desktop.matches,config,preview:manager.preview}),reading=false,readingExpanded=false,detailOpen=false,isList=true,chosen=null,controller=null,space='';
  function choose() {return desktop.matches?'bottomDesktop':'bottomMobile';}
  function available(name) {const unit=manager.config.units[name];return config.enabled&&(manager.preview||manager.enabled&&validAdUnit(unit.unit)&&validAdSize(unit,name));}
  function syncSpace() {
    const value=`${host.hidden?0:Math.ceil(host.getBoundingClientRect().height)}px`;
    if(value===space)return;space=value;doc.body.style.setProperty('--ev-ad-space',value);onSpaceChange();
  }
  function sync() {
    const name=choose(),active=reading&&isList?readingExpanded:expanded;
    if(chosen&&chosen!==name&&controller&&!controller.requested){controller.destroy();controller=null;chosen=null;}
    const mismatch=chosen&&chosen!==name;
    // Preserve a requested unit across resize; never request a second variant.
    host.hidden=!available(name)||mismatch||Boolean(controller?.failed)||(!desktop.matches&&detailOpen);
    panel.hidden=host.hidden||!active;
    button.textContent=panel.hidden?'광고 펼치기':'광고 접기';button.setAttribute('aria-expanded',String(!panel.hidden));
    if(!host.hidden&&!panel.hidden&&!controller){
      chosen=name;controller=manager.slot({host:panel,name,unit:manager.config.units[name],onChange:state=>{if(['no-ad','error'].includes(state))host.hidden=true;syncSpace();}});
    }
    controller?.update({eligible:!host.hidden&&active,allowed:!host.hidden&&active});
    if(controller?.failed)host.hidden=true;
    syncSpace();
  }
  function setExpanded(value){expanded=Boolean(value);if(reading&&isList)readingExpanded=expanded;try{win.sessionStorage.setItem(key,String(expanded));}catch{}sync();}
  const toggle=()=>setExpanded(panel.hidden);button.addEventListener('click',toggle);
  const resize=()=>sync();win.addEventListener('resize',resize,{passive:true});desktop.addEventListener('change',resize);
  const ro=win.ResizeObserver?new win.ResizeObserver(syncSpace):null;ro?.observe(host);
  sync();
  return {sync,setExpanded,setReading(value){if(Boolean(value)!==reading){reading=Boolean(value);readingExpanded=false;sync();}},
    setContext(next){isList=next.isList;detailOpen=next.detailOpen;if(!isList)reading=false;sync();},
    destroy(){ro?.disconnect();button.removeEventListener('click',toggle);win.removeEventListener('resize',resize);desktop.removeEventListener('change',resize);controller?.destroy();doc.body.style.setProperty('--ev-ad-space','0px');}};
}
