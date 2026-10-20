# 돌봄한눈 지도 소스 재사용 기록

확인·적용일: 2026-10-19

이 프로젝트는 사용자가 지정한 [돌봄한눈 원본 저장소](https://github.com/softm/homecare-nationwide-care-services-map)의 실제 지도 코드를 확인하여 공통 계산 모듈과 탐색 동작을 재사용했다. 원본 저장소는 변경하지 않았다. 기존 공단 자료·광고 설정·사이트 인증 파일·사업자 정보·서버 Secret은 복제하지 않았다.

2026-10-20 광고 추가 작업에서는 최신 돌봄한눈의 비동기 배너 초기화와 NO-AD 처리 방식을 참고했다. 광고단위 ID는 복제하지 않았으며 상세 구현·미설정 상태는 [AdFit 연결 문서](ADFIT.md)에 기록했다.

## 1. 원본 식별

| 항목 | 값 |
| --- | --- |
| 원본 저장소 | `softm/homecare-nationwide-care-services-map` |
| 조회 브랜치 | `main` |
| 조회 시점 main commit | `6c3a1fa7a4283f8b53dc0ca6ff5bc9643c45e16d` |
| 원본 진입점 | `index.html` |
| 확인한 지침 | 원본 `AGENTS.md` 553줄 전체. 신규 저장소에 그대로 복사하지 않음 |
| 라이선스 확인 | GitHub 메타데이터 license=null, 조회한 루트에 LICENSE 파일 없음 |

사용자 본인 저장소의 소스를 재사용하라는 개발 요청에 따른 작업이다. 원본이 특정 공개 라이선스로 배포되었다고 임의로 표시하지 않는다. 기존 코드의 주석을 그대로 보존하고 새로 작성·변형한 영역에는 현재 작업의 SOFTM 주석을 남겼다.

## 2. 원문을 변경 없이 복사한 코드

| 신규 경로 | 원본과 blob SHA | 실제 사용 위치 |
| --- | --- | --- |
| `public/vendor/homecare/care-popup-geometry.js` | [care-popup-geometry.js](https://github.com/softm/homecare-nationwide-care-services-map/blob/6c3a1fa7a4283f8b53dc0ca6ff5bc9643c45e16d/care-popup-geometry.js), `86d69f3b08f6e90c41eeecc4595b52880046e0cd` | `map.js`의 `focus()`. 상세 패널·지도 조작부가 가리는 영역을 계산하여 선택 충전소가 남은 지도 공간에 보이도록 중심 보정 |
| `public/vendor/homecare/map-marker-placement.js` | [map-marker-placement.js](https://github.com/softm/homecare-nationwide-care-services-map/blob/6c3a1fa7a4283f8b53dc0ca6ff5bc9643c45e16d/map-marker-placement.js), `76176ec5fd0470806036a0a295ef3de8c5af193a` | `map.js`의 `layoutLabels()`. 핀 실제 좌표를 유지하면서 이름표를 상·우·좌·하 여유 공간에 배치 |

파일 내용은 원본 Git blob SHA와 byte 단위로 대조했다. `tests/map-utils.test.mjs`가 이 두 SHA를 검사하므로 앞으로 원본 코드를 변경하면 재사용 기록도 함께 갱신해야 한다. 추가 라이선스나 저작권자를 만들어 넣지 않았다.

## 3. 전기차 앱에 맞게 새로 구성한 코드

`public/js/map.js`는 새 ES 모듈이며, 아래 원본의 동작 원칙을 전기차 데이터·네이버/Leaflet 두 제공자 공통 인터페이스에 맞게 구현했다.

| 원본 참고 코드 | 가져온 동작 | EV 적용 |
| --- | --- | --- |
| `index.html`의 `preserveCareSelectionResults`, `scheduleRefresh`, dragstart/dragend/idle 연결 | 상세 선택 이동이 현재 검색 결과와 마커 순번을 바꾸지 않게 함 | `createViewportGate()`: `focus()` 후 idle·resize 조회 억제, 실제 드래그·휠·핀치·키보드·확대 버튼 또는 명시 위치 검색에서 해제 |
| `index.html`의 Marker 생성 및 목록 선택 연결 | 목록과 마커의 고유 ID·순번 일치 | 전달한 목록의 index+1 유지. 좌표 없는 항목을 지도에서 제외해도 뒤 번호를 다시 당기지 않음 |
| `map-marker-labels.js` | 선택한 마커 우선, 확대 수준별 정보량 조절, 이전 배치 방향 보존 | 선택 라벨 우선·확대별 개수 제한·직전 배치 방향으로 이름표 안정성 유지 |
| `care-popup-geometry.js` | 팝업 닫기/선택 후 지도 위치 보존 | `data-map-obstacle` 패널 실측 보정. 상세를 닫는 동작은 지도 중심·배율을 변경하지 않음 |
| `care-data.js`, `nhis-static-data.js` | 자료 조회 실패와 빈 결과를 구분 | 지도 SDK·타일 실패는 별도 오류 상태, 충전소 목록과 제공 데이터는 유지 |

공단 기관기호 11자리 전용 `map-share-state.js`, 공단 상세·주소 보완 지오코더, 495KB 행정경계 자료는 전기차 API의 영숫자 충전소 ID와 위경도에 맞지 않아 복사하지 않았다. 상태별 색과 대기 수는 지도 내부에서 원시 상태를 다시 추정하지 않고 프런트의 신선도 판정 `summaries`를 사용한다. 확인되지 않은 요약은 회색 `?`로 표시한다.

전국·시도 자료를 모두 DOM 마커로 만들지 않는다. `selectMarkerModels()`가 실제 화면 안을 먼저 선택하고 주변 12% 여유 영역을 추가하며, 기본 600개 이내로 제한한다. 선택한 충전소는 화면 밖이나 뒤쪽 순번이어도 유지하고 마커 번호는 원본 목록 index+1을 사용한다. 실제 화면 안의 일부가 제한될 때 지도 표시 수와 확대 안내를 함께 표시한다. 이동 종료마다 현재 영역의 마커를 갱신하며 목록·집계 자체를 마커 상한으로 줄이지 않는다.

## 4. 지도 제공자와 외부 자산

| 제공자 | 연결 | 동작 |
| --- | --- | --- |
| 네이버 Maps JavaScript SDK | `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=…&submodules=geocoder` | `config.naverMapClientId`가 설정되면 우선 사용. 공개 Application Key ID만 브라우저에 전달하며 원본 공용 ID 사용 시 새 Web 서비스 Origin의 등록 여부를 확인해야 함 |
| Leaflet 1.9.4 | 공식 Quick Start에 명시된 unpkg JS·CSS, 버전 고정·SRI·`crossorigin=anonymous` | 네이버 미설정 또는 SDK·인증 실패 시 실제 OpenStreetMap 배경지도로 전환 |
| OpenStreetMap Standard tiles | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | 화면에 필요한 타일만 요청. 출처 표시·저작권 링크 유지. 오프라인 타일 저장이나 대량 사전 수집을 구현하지 않음 |

Leaflet 파일을 신규 저장소에 복사하지 않고 공식 안내의 CDN 경로로 로드한다. 아래 값을 `config.leafletAssets`로 지정하면 추후 검증된 로컬 번들로 바꿀 수 있다.

```js
leafletAssets: {
  script: './vendor/leaflet/leaflet.js',
  style: './vendor/leaflet/leaflet.css',
  scriptIntegrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  styleIntegrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
}
```

로컬 파일이 실제 준비되기 전에는 위 예시 설정을 추가하지 않는다. 기본 로드는 CDN만 요청하여 존재하지 않는 로컬 파일 404를 먼저 발생시키지 않는다. 두 제공자 모두 지도 출처를 표시하고 대체 전환·지도 타일 연결 실패를 별도 안내한다. 지도 그림을 임의 이미지로 대체하지 않는다.

공식 참고 문서:

- [네이버 Map 메서드·이벤트](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Map.html)
- [Leaflet 1.9.4 API](https://leafletjs.com/reference.html)
- [Leaflet 공식 Quick Start](https://leafletjs.com/examples/quick-start/)
- [OpenStreetMap 타일 이용 정책](https://operations.osmfoundation.org/policies/tiles/)

## 5. 지도 모듈 계약

```js
const map = await createMap({
  container, config,
  onSelect: stationId => {},
  onBoundsChange: ({ south, north, west, east }) => {},
  onBackgroundClick: () => {},
  onError: error => {} // Error.message, Error.code, Error.recoverable
});
```

| 메서드 | 동작 |
| --- | --- |
| `setStations(rows, {selectedId, summaries})` | 지도 마커와 목록 ID·순번·선택 상태 동기화. 기존 마커 인스턴스 재사용 |
| `focus(station, {zoom: 15})` | 선택한 위치로 이동·팝업 가림 보정. 자동 재검색 억제 |
| `setCenter({lat,lng}, zoom)` | 명시 검색 위치로 이동하고 현재 영역 조회 콜백 실행 |
| `locate({lat,lng})` | 전달받은 현재 위치 표시 후 줌 15로 이동. 이 함수 자체는 위치 권한을 요청하지 않음 |
| `getBounds()` / `getCenter()` / `getZoom()` | 실제 제공자 지도의 현재 영역·중심·확대값. 지도 전환 대기에는 보존한 위치·확대값 반환 |
| `resize()` | DOM 크기 변경 반영. 선택 보존 상태에서는 목록 재조회하지 않음 |
| `destroy()` | 지도·마커·이벤트·observer 정리 |

컨테이너는 CSS에서 실제 높이를 가져야 한다. 지도 위에 겹치는 검색 카드·상세 패널에는 `data-map-obstacle` 속성을 지정하면 선택 마커와 이름표가 그 영역을 피한다. 원본 기준 기본 위치인 서울시청은 현재 위치라고 표시하지 않는다. 사용자의 위치 접근은 앱의 `내 위치` 행동에서만 요청한다.

## 6. 검증

```bash
node tests/map-utils.test.mjs
```

좌표 미제공 처리, 목록 번호 일치, 잘못된 상태 집계, 수집 문구의 HTML 안전 처리, 선택 후 idle·resize 재조회 억제, 경계 포함 판정, 원본 팝업·라벨 배치, 원문 SHA 일치를 검사한다. 실제 제공자의 네트워크·키 허용 Origin과 모바일 지도 조작은 브라우저 통합 검증으로 확인해야 한다.
