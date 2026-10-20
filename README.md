# 충전한눈 전기차 충전소 앱

[앱 열기](https://softm.github.io/evchargingstation/) · [화면 체험](https://softm.github.io/evchargingstation/?demo=1) · [소스](https://github.com/softm/evchargingstation)

**2026-10-20 최신 검증:** 앱과 체험 화면은 GitHub Pages에 배포되어 있으며 자동 테스트 45개(JavaScript 19개 + Python 26개), 검사·빌드가 통과했습니다. 실제 API의 HTTP 403 응답에서 오류코드 `30`을 확인했고, 수동 `full` 수집 실패 시 신규 배포를 중단하도록 보완했습니다. 실제 충전소 수집은 인증 오류로 미완료이며 자동 갱신은 비활성입니다. [검증 결과와 남은 확인 사항](docs/VALIDATION.md)을 참고하세요.

한국환경공단의 충전소·충전기 정보를 지도와 목록으로 확인하는 앱입니다. 사용자 소유 [돌봄한눈 소스](https://github.com/softm/homecare-nationwide-care-services-map)의 지도 동작과 작은 공통 모듈을 활용했습니다.

**기본 화면에는 실제 수집을 마친 충전소 데이터만 표시합니다.** 기본 화면에 가상의 충전소를 넣지 않습니다. `?demo=1` 화면 체험은 모든 시설명이 `예시`로 표시되는 별도 가상 데이터이며 실제 위치 탐색·충전 판단 자료가 아닙니다. 정상 수집과 원본 대조 전에는 API 성공, 전국 충전소 수, 운영 중 상태를 검증했다고 보지 않습니다.

## 구현 범위

| 영역 | 동작 |
| --- | --- |
| 지도 | 네이버 Maps, 실패 시 Leaflet·OpenStreetMap 대체 지도 |
| 탐색 | 지역별 분할 로딩, 현재 지도 영역 탐색, 목록·번호 마커 연동 |
| 조건 | 검색어, 커넥터, 출력, 충전대기, 주차료, 이용제한 |
| 상세 | 충전기별 상태·출력·유형, 운영시간, 주소·위치, 이용제한, 전화·길찾기 |
| 저장·공유 | 기기 내 즐겨찾기, 선택한 충전소·지역·검색 조건 공유 |
| 데이터 | 전체 정보 수집과 상태 변경분 병합, 상태 변경·확인 시각 구분 |
| 신뢰성 | 부분 수집 차단, 호출량 제한, 재시도, 중단 후 재수집, 이전 정상 자료 보존 |
| 배포 | GitHub Pages 단일 워크플로와 선택적 주기 수집 |

기술은 Vanilla ES modules, HTML/CSS, Python 표준 라이브러리입니다. Node.js 22 이상은 빌드와 테스트에 사용합니다. npm·Python 추가 패키지 설치가 필요하지 않습니다.

## 로컬 실행

```bash
git clone https://github.com/softm/evchargingstation.git
cd evchargingstation
python3 -m server --host 127.0.0.1 --port 8000
```

[로컬 앱](http://127.0.0.1:8000/)과 [로컬 화면 체험](http://127.0.0.1:8000/?demo=1)을 엽니다. Python 3.11 이상을 사용합니다. 서비스키가 없으면 지도와 데이터 준비 안내가 표시됩니다.

실제 데이터를 사용할 때는 운영 환경의 비밀변수 `DATA_GO_KR_SERVICE_KEY`를 설정합니다. `.env.example`은 이름 안내용이며 Python이 `.env`를 자동으로 읽지는 않습니다. 서비스키를 명령행 인수, URL 공유, 공개 소스, 브라우저 저장소에 넣지 마세요.

```bash
python3 scripts/collect.py --mode full --output public/data --state-dir .cache/evchargingstation
python3 -m server --host 127.0.0.1 --port 8000
```

## GitHub에서 실제 데이터 연결

1. [한국환경공단 전기자동차 충전소 정보](https://www.data.go.kr/data/15076352/openapi.do)에서 활용신청과 인증키를 확인합니다.
2. [Actions Secrets](https://github.com/softm/evchargingstation/settings/secrets/actions)에 `DATA_GO_KR_SERVICE_KEY`를 등록합니다. 브라우저에 전달되지 않는 서버용 키입니다.
3. [Actions](https://github.com/softm/evchargingstation/actions/workflows/collect-and-deploy.yml)에서 `Run workflow` → `collection_mode: full`을 실행합니다.
4. 앱의 실제 충전소 수, 수집 시각, 지역 분할 로딩, 임의의 실제 충전기 상태를 원본과 대조합니다. 호출 허용량도 확인합니다.
5. [Actions Variables](https://github.com/softm/evchargingstation/settings/variables/actions)에 `ENABLE_SCHEDULED_COLLECTION=true`를 등록하면 5분 간격 예약 수집 대상이 됩니다. 최초 `full` 수집과 실제 응답 검증이 끝난 뒤에만 예약 수집을 켭니다.

| 설정 | 구분 | 기본값·용도 |
| --- | --- | --- |
| `DATA_GO_KR_SERVICE_KEY` | Secret | 공공데이터 API 인증키 |
| `PUBLIC_NAVER_MAP_CLIENT_ID` | Variable | 기존 지도 공개 Application Key ID 사용. 다른 앱 ID로 교체 가능 |
| `PUBLIC_EV_API_BASE_URL` | Variable | 비우면 정적 snapshot. 운영 API가 있으면 HTTPS 주소 |
| `PUBLIC_EV_DATA_BASE_URL` | Variable | 기본 `./data` |
| `ENABLE_SCHEDULED_COLLECTION` | Variable | 기본 비활성. `true`일 때만 예약 수집 |
| `MAX_API_CALLS_PER_RUN` | Variable | 기본 100, 페이지·재시도 포함 |
| `MAX_API_CALLS_PER_DAY` | Variable | 기본 1000, 실제 승인된 계정 한도에 맞춤 |

[Pages 설정](https://github.com/softm/evchargingstation/settings/pages)의 Source는 **GitHub Actions**로 유지합니다. 배포 소스는 빌드 결과 `dist/`이며 공개 URL 뒤에 `/dist`를 붙이지 않습니다. 기본 브랜치 빌드와 별도 데이터 배포가 서로 덮어쓰지 않도록 단일 워크플로만 사용합니다.

## 네이버 지도 설정

공개 Maps Application Key ID는 원본 돌봄한눈 소스의 값을 재사용하며 API Secret과 다릅니다. [네이버 Maps 공식 시작 문서](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html)를 따라 해당 Application의 웹 서비스 URL에 `https://softm.github.io` 및 사용할 운영 도메인을 등록합니다. ID는 `PUBLIC_NAVER_MAP_CLIENT_ID`로 교체할 수 있습니다. 미등록 도메인 또는 SDK 오류가 나면 출처가 표시된 OpenStreetMap 지도로 전환합니다.

OpenStreetMap 기본 타일은 브라우저에서 필요한 화면만 요청합니다. 대량 내려받기·오프라인 저장을 하지 않으며 운영 규모에 맞게 [OSM 타일 정책](https://operations.osmfoundation.org/policies/tiles/)을 확인하고 제공자를 선택합니다.

## 데이터 의미와 최신성

`getChargerInfo`는 충전소·충전기 기본 정보 및 상태를 읽습니다. `getChargerStatus`는 최근 1~10분에 변경된 상태를 읽습니다. 빈 변경분은 시설이 사라졌다는 뜻이 아닙니다. **상태 변경 시각인 `statUpdDt`는 마지막 통신 확인 시각이 아닙니다.** 수집기는 각 응답의 확인 시각과 연속 변경분 수집 범위를 따로 관리합니다.

화면의 충전대기 집계는 같은 충전기의 커넥터·출력·상태 조건과 확인 시각을 함께 검사합니다. 확인이 10분을 초과한 상태는 현재 충전대기로 추천하지 않습니다. 이 10분은 앱의 표시 기준이며 제공기관의 실시간 보장 시간이 아닙니다. 예약 중(6), 상태 미확인(9), 버스 전용(타입11), 미등록 코드도 별도로 처리합니다.

GitHub 예약 실행은 지연되거나 누락될 수 있습니다. 10분 이상 변경분 수집이 끊기면 전체 정보로 회복합니다. 출처의 마지막 상태 변경은 오래됐더라도 연속 수집이 정상일 수 있습니다. 전체 수집 또는 페이지 일부 실패 시 최신 확인 시각을 거짓으로 앞으로 옮기지 않습니다. GitHub Actions 캐시가 소실되어도 정상 snapshot 없음을 확인하고 전체 재수집합니다.

더 안정적인 상태 갱신이 필요하면 포함된 Python 서버를 지속 실행할 수 있는 HTTPS 환경에 두고 `PUBLIC_EV_API_BASE_URL`로 연결합니다. 서버 기본 수집 간격은 300초이며 모든 이용자가 한 수집 캐시를 공유합니다. 별도 웹 출처를 허용하려면 `EV_ALLOWED_ORIGINS`를 명시합니다. 이 저장소의 GitHub Pages는 Python 서버 자체를 실행하지 않습니다.

요금, 예약 실행, 대기 차량 수, 차량 배터리 SOC, 도착 시점의 충전 가능 여부는 이 API에 없습니다. 출력(kW)을 요금으로 표시하거나 충전 시작 시각으로 남은 대기시간을 추정하지 않습니다. 주차료·이용제한 미확인은 무료·제한 없음으로 간주하지 않습니다.

## 검증과 소스 안내

```bash
npm run check
npm test
npm run build

# 게시된 주소의 앱·자산·데이터 계약 확인
npm run verify:deployment -- https://softm.github.io/evchargingstation/
```

[API 명세와 가정](docs/API_NOTES.md), [소스 재사용 내역](docs/SOURCE_REUSE.md), [운영·배포 구조](docs/OPERATIONS.md)를 함께 확인합니다.

데이터 출처: [한국환경공단·공공데이터포털](https://www.data.go.kr/data/15076352/openapi.do), 활용가이드 v1.25. 기관이 제작·운영하거나 승인한 공식 앱이 아닌 민간 정보 서비스입니다. 원본 코드의 저작권·라이선스와 데이터 출처표시 조건은 각각 적용됩니다.
