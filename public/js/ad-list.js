/** Re-render cards in stable segments; mounted ad nodes and iframes stay connected. */
export function listAdPositions(config) {
  const p=config.placements.listInline;
  return p.enabled ? p.positions.slice(0,Math.max(0,Math.min(3,Math.floor(Number(p.maxSlots)||0)))) : [];
}
export function mountListAds({root,manager,doc=document}) {
  const positions=listAdPositions(manager.config), segments=[doc.getElementById('listBeforeAd')],hosts=[],slots=[];
  const first=doc.getElementById('adfitBanner'),after=doc.getElementById('listAfterAd');
  for (const [i,position] of positions.entries()) {
    const host=i===0?first:doc.createElement('aside');
    if(i){host.id=`adfitBanner${i+1}`;host.className='adfit-banner';host.setAttribute('aria-label','광고');host.innerHTML='<span class="adfit-label">광고</span><div class="adfit-creative"></div>';root.append(host);}
    host.dataset.afterStation=String(position);hosts.push(host);
    const segment=i===0?after:doc.createElement('div');if(i){segment.id=`listAfterAd${i+1}`;root.append(segment);}segments.push(segment);
    slots.push(manager.slot({host,root,name:`list${i+1}`,unit:manager.config.units[`list${i+1}`]}));
  }
  if (!positions.length) {first.hidden=true;after.innerHTML='';}
  return {render({shown,total,card,empty='',more=''}) {
    let start=0;
    for (let i=0;i<segments.length;i++) {
      const end=positions[i]??shown.length;
      segments[i].innerHTML=shown.slice(start,end).map(card).join('')+(i===0&&!shown.length?empty:'')+(i===segments.length-1?more:'');start=end;
    }
    for(let i=0;i<slots.length;i++)slots[i].update({eligible:total>6&&shown.length>positions[i]});
  },sync:()=>slots.forEach(s=>s.sync()),hosts};
}
