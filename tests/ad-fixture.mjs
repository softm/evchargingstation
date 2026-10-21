// Minimal DOM doubles: no actual SDK or network is used by these fixtures.
export function adFixture({width=1000,storage=new Map()}={}) {
 const created=[],timers=new Map(),observers=[],mutations=[],nodes=new Map();let sequence=0;
 class Events {
  constructor(){this.listeners=new Map();}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type,event={}){for(const fn of this.listeners.get(type)||[])fn({type,...event});}
 }
 class Node extends Events {
  constructor(tag='div'){super();this.tag=tag;this.dataset={};this.attrs={};this.children=[];this.parentNode=null;this.hidden=false;this.width=null;this.top=100;this.height=180;this.open=false;this.textContent='';this.html='';const css=new Map();this.style={setProperty:(k,v)=>css.set(k,v),getPropertyValue:k=>css.get(k)};this.classList={add(){},toggle(){}};}
  set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
  setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k]??null;}
  append(...nodes){for(const node of nodes){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(x=>x!==node);this.children.push(node);node.parentNode=this;}}
  remove(){this.removed=true;if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
  set innerHTML(text){this.html=text;for(const child of this.children)child.parentNode=null;this.children=[];if(text.includes('adfit-creative')){const c=new Node();c.className='adfit-creative';this.append(c);}}get innerHTML(){return this.html;}
  querySelector(selector){if(selector==='button')return this.walk().find(n=>n.tag==='button');if(selector==='iframe')return this.walk().find(n=>n.tag==='iframe');return this.walk().find(n=>n.className?.split(' ').includes(selector.slice(1)));}
  querySelectorAll(selector){if(selector==='[data-welcome-close]')return this.walk().filter(n=>n.attrs['data-welcome-close']!==undefined);return [];}
  walk(){return this.children.flatMap(n=>[n,...n.walk()]);}
  getBoundingClientRect(){let visible=!this.hidden;for(let p=this.parentNode;p;p=p.parentNode)if(p.hidden)visible=false;const panel=this.querySelector('.ad-bottom-panel');const height=visible?(this.className==='ad-bottom'?44+(panel&&!panel.hidden?140:0):this.height):0;return {top:this.top,bottom:this.top+height,width:this.width??win.width,height};}
  showModal(){this.open=true;}close(){this.open=false;this.emit('close');}focus(){doc.activeElement=this;}
 }
 const doc=new Events();doc.hidden=false;doc.createElement=tag=>{const n=new Node(tag);created.push(n);return n;};doc.getElementById=id=>nodes.get(id);doc.body=new Node('body');
 const win=new Events();win.width=width;win.innerHeight=900;win.location={origin:'https://softm.github.io',pathname:'/evchargingstation/'};
 win.setTimeout=fn=>{timers.set(++sequence,fn);return sequence;};win.clearTimeout=id=>timers.delete(id);
 win.sessionStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
 win.getComputedStyle=()=>({visibility:'visible'});
 const media=new Events();Object.defineProperty(media,'matches',{get:()=>win.width>=761});win.matchMedia=()=>media;
 win.IntersectionObserver=class {constructor(fn,options){this.fn=fn;this.options=options;observers.push(this);}observe(node){this.node=node;}unobserve(){}disconnect(){this.disconnected=true;}visible(value=true){this.fn([{isIntersecting:value,intersectionRatio:value?1:0,target:this.node}]);}};
 win.MutationObserver=class {constructor(fn){this.fn=fn;mutations.push(this);}observe(){}disconnect(){}};
 const root=new Node();root.top=0;root.height=900;const before=new Node();before.id='listBeforeAd';const host=new Node('aside');host.id='adfitBanner';host.className='adfit-banner';host.innerHTML='<div class="adfit-creative"></div>';const after=new Node();after.id='listAfterAd';root.append(before,host,after);
 const bottom=new Node('aside');bottom.className='ad-bottom';bottom.id='bottomAd';const toggle=new Node('button'),panel=new Node();panel.className='ad-bottom-panel';panel.innerHTML='<div class="adfit-creative"></div>';bottom.append(toggle,panel);
 const welcome=new Node('dialog');const preview=new Node();preview.className='welcome-ad-preview';const close=new Node('button');close.setAttribute('data-welcome-close','');welcome.append(preview,close);
 return {Node,win,doc,created,timers,observers,mutations,root,host,bottom,toggle,panel,welcome,storage,media,
  networkScripts:()=>created.filter(n=>n.tag==='script'),resize(next){win.width=next;media.emit('change');win.emit('resize');},visibleAll(){for(const o of [...observers])o.visible();},fireTimers(){for(const [id,fn]of [...timers]){timers.delete(id);fn();}}};
}
