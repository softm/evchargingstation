# 충전한눈 Kakao AdFit 운영

## 지면과 활성화

| 지면 | 구현 | 실제 광고 활성화 조건 |
| --- | --- | --- |
| 목록 1·2·3 | 6·18·30번째 카드 뒤, 최대 3개, 각각 독립 DOM과 NO-AD 콜백 | 등록 매체에서 발급한 서로 다른 단위, 규격 일치, 활성화 변수 |
| 하단 PC | 728×90, 콘텐츠 높이 확보, 세션 접힘 저장 | 단위 등록 및 사용자의 펼침 선택 |
| 하단 모바일 | 320×100, 기본 접힘, Safe Area, 상세 중 임시 숨김 | 모바일 단위 등록 및 사용자의 펼침 선택 |
| 웰컴 | 서비스 안내, 즉시 닫기·Escape·모달 포커스, 세션별 표시, 미리보기 | 안내 UI만 선택적으로 사용. 실제 팝업 광고는 호출하지 않음 |

현재 모든 단위는 빈 문자열이고 `enabled:false`, `mode:'off'`다. 다른 서비스의 광고 ID를 복사하거나 임의 ID를 운영 설정에 만들지 않는다. 실제 광고 노출·승인·수익은 미검증 상태다.

## 공개 설정

[Actions Variables](https://github.com/softm/evchargingstation/settings/variables/actions)에 설정한다. 광고단위는 공개 배치 식별자다. 계정 비밀번호와 관리자 토큰은 넣지 않는다.

| 변수 | 지면 | 규격 |
| --- | --- | --- |
| `PUBLIC_ADFIT_ENABLED` | 전체 실제 광고 요청 허용 | `true` / `false` |
| `PUBLIC_ADFIT_LIST_1_UNIT` | 목록 6번째 뒤 | 기본 320×100 |
| `PUBLIC_ADFIT_LIST_2_UNIT` | 목록 18번째 뒤 | 기본 320×100 |
| `PUBLIC_ADFIT_LIST_3_UNIT` | 목록 30번째 뒤 | 기본 320×100 |
| `PUBLIC_ADFIT_BOTTOM_DESKTOP_UNIT` | 하단 PC | 728×90 |
| `PUBLIC_ADFIT_BOTTOM_MOBILE_UNIT` | 하단 모바일 | 320×100 |
| `PUBLIC_ADFIT_WELCOME_UNIT` | 보류 지면 식별자만 보관 | 실제 호출 없음 |
| `PUBLIC_ADFIT_BANNER_UNIT` | 기존 목록 1 호환 별칭 | 신규 list1 변수가 있으면 신규 값 우선 |

기존 `PUBLIC_ADFIT_BANNER_UNIT`만 설정한 운영 방식은 계속 작동한다. `PUBLIC_ADFIT_ENABLED=false`가 명시되면 기존 값이 있어도 요청하지 않는다. 새 변수만 설정하는 경우에는 `PUBLIC_ADFIT_ENABLED=true`를 함께 지정한다. 미발급 지면은 빈 값으로 둔다. 300×250으로 발급받은 목록 광고는 `public/ad-config.js`의 해당 단위 `width`, `height`를 정확히 바꾸고 재배포한다. ID만 바꿔서 규격을 추측하지 않는다. 중복 단위·잘못된 ID·지원하지 않는 규격은 빌드에서 거절한다.

## 수명주기와 공간

- `disabled / unconfigured / idle / loading / loaded / no-ad / error`를 단위별로 관리한다. `loaded`는 iframe 렌더링 신호이며 유료 노출·수익 확인이 아니다.
- 공식 `ins.kakao_ad_area`와 SDK 스니펫, 단위별 고유 `data-ad-onfail`만 사용한다. 비공식 SDK 메서드나 팝업 API를 쓰지 않는다. 새로 보이는 단위당 공식 스니펫을 한 번 설치하고 정렬·필터·갱신으로 다시 설치하지 않는다.
- IntersectionObserver 50% 가시성, 실제 크기, 문서 표시 상태와 모달 문맥을 확인한다. 숨겨진 모바일 목록·백그라운드·예시 데이터·미리보기는 실제 광고를 요청하지 않는다.
- SDK 로딩 20초, 로딩 후 응답 30초 한도로 실패를 정리한다. NO-AD는 해당 슬롯만 없앤다. 차단·오류·타임아웃은 `error`로 구분하며 재요청하지 않는다.
- 페이지당 요청되는 단위를 최대 4개로 제한한다. 하단 광고를 요청한 뒤 화면 규격이 바뀌면 기존 규격이 맞는 화면으로 돌아올 때 재사용하고, 다른 단위를 추가 요청하지 않는다. 미리보기/아직 요청하지 않은 하단 지면만 안전하게 규격을 전환한다.
- 실제 하단 광고는 처음에 사용자가 펼치기 전까지 요청하지 않는다. PC의 기본 펼침 권장은 미리보기에서 적용하고, 실제 광고에서는 수동 펼침 조건을 우선한다. 같은 세션의 명시적 펼침 선택은 복원한다.
- 목록 읽기 중 자동 접힘과 모바일 상세 중 임시 숨김은 저장된 사용자 선택을 덮어쓰지 않는다. 광고의 실측 높이를 `--ev-ad-space`로 반영해 지도·목록·상세·토스트 공간을 확보한다. 닫기·접기 컨트롤은 소재 바깥에 둔다.
- 목록 광고 DOM을 유지하고 카드만 세그먼트별로 갱신한다. 선택은 계속 stationId로 찾는다. 6개 이하이거나 광고 뒤에 카드가 없는 결과는 목록 광고를 표시하지 않는다. 고정 규격보다 영역이 좁으면 소재를 자르거나 축소하지 않고 해당 지면을 숨긴다.

## 정책과 보류

2026-10-21 공식 운영정책 확인 결과, 한 페이지 4개 초과 광고, 콘텐츠를 덮는 광고, 닫기 버튼의 소재 내부 배치, 승인되지 않은 팝업 광고 호출 등이 제한되어 있다. 따라서 목록 최대 3개+현재 화면의 하단 1개만 허용한다. `welcome.adfitApproved`나 `PUBLIC_ADFIT_WELCOME_UNIT`만으로 실제 팝업 광고를 켤 수 없다. 허용된 웹 팝업 방식이 확인되지 않았으므로 실제 호출 경로를 구현하지 않았다. 추후 승인된 일반 배너로 사용하려면 등록한 동일 규격 단위를 비어 있는 일반 배너 지면에 배정하고 기존 지면과 중복 사용하지 않는다.

- [AdFit 운영정책](https://adfit.kakao.com/web/html/use_kakao.html)
- [공식 Web Guide](https://adfit.github.io/wiki/web-guide/)
- [공식 SDK와 NO-AD 문서](https://github.com/adfit/adfit-web-sdk)

돌봄한눈 `care-list-ads.js`, `care-list-ads.css`, `care-list-ad-config.js`, `nationwide-care-ad-config.js`, `index.html`의 세션·접힘·NO-AD·목록 흐름을 참고했다. 광고 ID와 비공식 SDK 호출은 가져오지 않았다.

## 검증

[운영 미리보기](https://softm.github.io/evchargingstation/?ad-preview=1&region=11&sort=name)는 실제 SDK 호출 없이 목록 슬롯·하단·웰컴 안내를 보여준다. 웰컴은 세션당 한 번이며 데이터 안내의 서비스 안내 버튼으로 다시 열 수 있다. 미리보기 세션 키는 실제 운영 선택과 분리한다.

`npm run check`, `npm test`, `npm run build`, `npm run verify:deployment -- https://softm.github.io/evchargingstation/`를 실행한다. 자동 테스트의 ID와 SDK 응답은 네트워크 없는 테스트 전용이다. NO-AD·차단·타임아웃 처리는 모의 검증이며, 광고단위 발급 전 실제 광고 응답 성공으로 보고하지 않는다.
