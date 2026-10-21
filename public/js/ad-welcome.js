// Web popup advertising is not activated by any unit ID or approval flag.
// Until an explicitly permitted format exists, this dialog is service guidance only.
export const WELCOME_STORAGE_KEY='evchargingstation:welcome:shown:v1';
export function mountWelcome({dialog,manager,win=window,doc=document,onChange=()=>{}}) {
  const config=manager.config.placements.welcome,key=WELCOME_STORAGE_KEY+(manager.preview?':preview':''),ad=dialog.querySelector('.welcome-ad-preview');
  let shown=false,previous;
  try{shown=win.sessionStorage.getItem(key)==='true';}catch{}
  ad.hidden=!manager.preview;
  const close=()=>dialog.close();
  for(const button of dialog.querySelectorAll('[data-welcome-close]'))button.addEventListener('click',close);
  dialog.addEventListener('close',()=>{onChange();previous?.focus?.({preventScroll:true});});
  const open=()=>{
    if(dialog.open)return;previous=doc.activeElement;dialog.showModal();shown=true;
    try{win.sessionStorage.setItem(key,'true');}catch{}onChange();
  };
  return {open,start(){if((manager.preview||config.enabled)&&(!config.oncePerSession||!shown))open();},get shown(){return shown;}};
}
