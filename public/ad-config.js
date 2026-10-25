/* Public placement IDs issued specifically for 충전한눈. Empty means no SDK call.
 * PUBLIC_ADFIT_BANNER_UNIT remains a legacy alias for list1 only.
 * Welcome is an optional service introduction; actual popup ads remain disabled.
 */
window.EV_AD_CONFIG = Object.freeze({
  enabled: true,
  mode: 'adfit',
  script: 'https://t1.kakaocdn.net/kas/static/ba.min.js',
  placements: {
    listInline: {enabled:true,positions:[6],maxSlots:1},
    bottomAnchor: {enabled:true,mobileDefaultExpanded:true,desktopDefaultExpanded:true},
    welcome: {enabled:false,adfitApproved:false,oncePerSession:true}
  },
  units: {
    list1:{unit:'DAN-fNOUP1ElmgvvBj6u',width:300,height:250}, list2:{unit:'',width:320,height:100}, list3:{unit:'',width:320,height:100},
    bottomDesktop:{unit:'DAN-BSuQNTdisNzt5FNQ',width:728,height:90}, bottomMobile:{unit:'DAN-GARaUEV62FfEDUGr',width:320,height:100}, welcome:{unit:'',width:320,height:100}
  }
});
