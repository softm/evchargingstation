# 충전한눈 전국 데이터 수집·갱신 운영 기준

최종 수정: 2026-10-20. 실시간 집계값은 [운영 매니페스트](https://softm.github.io/evchargingstation/data/manifest.json)를 기준으로 확인합니다.

## 1. 수집 대상

| 분류 | 제공기관·서비스 | 저장 필드 | 운영 상태 |
| --- | --- | --- | --- |
| 기본정보 | [한국환경공단 getChargerInfo](https://www.data.go.kr/data/15076352/openapi.do) | 충전소·충전기 ID, 타입, 출력, 이름, 주소, 위·경도, 운영사, 운영시간, 주차료 무료 여부, 이용 제한, 전화번호 | 전국 전체 API 수집 |
| 누락분 보강 | 같은 getChargerInfo | `kind`, `kindDetail`, `trafficYn`, `floorNum`, `floorType`, `maker`, `year`, `powerType` | 2026-10-20 코드 추가, 이후 `full` 재수집에서 채움 |
| 상태 | 한국환경공단 getChargerStatus | 상태 코드, 상태변경일시, 확인범위 | 자동 실행; 유효한 기준시각만 사용 |
| 정부 공공충전 요금 | [무공해차 통합누리집](https://ev.or.kr/nportal/evcarInfo/initEvcarChargePriceV2.do) | 정부 운영 충전기의 5개 출력대별 공표 회원 요금 | `data/fees.json` 참고값으로 별도 게시 |
| 민간 요금 | [차지인포](https://chargeinfo.ksga.org/front/fee/feeTable) | 사업자별 평균 안내요금·요금제 | 재배포 허락 전 자동 수집 금지, 수집기 구현·권한 게이트 적용 |
| 충전 대기 차량, 실제 주차면 점유, 예약 가능 여부, 사용자 리뷰 | 제공기관별 별도 계약 필요 | 수집 가능한 공식 필드가 확인되지 않음 | 미수집. 가상값 사용 금지 |

요금 관련 핵심 구분: 공공기관 또는 협회 화면에 요금이 공개돼 있어도 일반 제3자용 자동 재배포 권한까지 자동으로 허용되는 것은 아닙니다. [차지인포 이용약관](https://chargeinfo.ksga.org/front/agreement/use)은 사전 승인 없는 상업적 재이용·재배포를 제한하므로 `CHARGEINFO_REUSE_APPROVED`가 명시적으로 `true`인 경우에만 요금 수집을 시작합니다. 단순 공개 조회가 API 서비스 계약을 대체하지 않습니다. 필요한 경우 협회에 별도 계약을 요청합니다.

## 2. 실제 저장 구조

```text
public/data/manifest.json
public/data/fees.json
public/data/releases/<release-id>/regions/{11,12,...}.json
.cache/evchargingstation/state.json
.cache/evchargingstation/budget.json
dist/data/manifest.json
dist/data/fees.json
dist/data/releases/<release-id>/regions/11.json.gz
```

- 지역 파일은 **전국 목록을 한 번 완전하게 받은 다음** 원본 지역코드로 분리합니다. 부분 페이지와 중복 식별자를 검증합니다.
- 원본 JSON을 개발·수집 서버에서 유지하고, 배포 빌드에서만 지역별 gzip 압축을 수행합니다. 요금표는 크기가 작아서 일반 JSON으로 제공합니다.
- 현재 브라우저 화면은 최대 4개 지역 파일만 해제하며 원래의 전체 목록을 화면마다 다운로드하지 않습니다.
- 확인 시각 `observedAt` · 연속 상태조회 범위 `statusCoverageAt` · 변경 시각 `statusChangedAt`을 별도로 보관합니다.
- `dataCompleteness`에 상위 항목별 실데이터 존재 건수를 기록하여 원본 미제공과 수집 오류를 구분합니다.

## 3. GitHub Actions 스케줄

[단일 수집·배포 워크플로](https://github.com/softm/evchargingstation/actions/workflows/collect-and-deploy.yml)를 사용합니다.

| 작업 | 기준 | 처리 |
| --- | --- | --- |
| 상태 변경분 | 5분 Cron: `3-59/5 * * * *` (UTC) | `auto`: 이전 연속 확인범위부터 최근 10분의 변경분 조회 |
| 전국 목록 | `auto`에서 이전 전체정보 수집으로부터 24시간 경과 | 전체 `getChargerInfo` 갱신(페이지 최대 9,999개 항목, 보통 약 53페이지) |
| 누락 시간 회복 | 10분 이상 연속 수집 누락, 새 충전기 발견, 캐시 손실, API 오류 | 이전 정상 자료 보존·전국 목록으로 재동기화 |
| 요금 데이터 | 매번 검사, 마지막 승인 수집 후 24시간 이상일 때만 외부 조회 | 승인된 경우에만 2개 제한된 데이터 응답 조회 |
| 배포 | 수집된 데이터가 실제 갱신된 경우 또는 일반 코드 푸시 | 테스트 후 `dist`를 GitHub Pages 배포 |
| 강제 전체 재수집 | `workflow_dispatch: collection_mode=full` 또는 커밋 메시지 `[collect:full]` | 강제 전국 재수집 실패 시 새 배포 차단 |
| 스케줄 일시 중지 | Actions 변수 `PAUSE_EV_COLLECTION=true` | 예약 수집 정지. 수동 실행은 유지 |

- **서비스키:** `DATA_GO_KR_SERVICE_KEY` (GitHub Actions Secret).
- **요금 정보 재이용 승인:** `CHARGEINFO_REUSE_APPROVED=true` (GitHub Actions Variable), 사업자·협회로부터 실제 승인을 받은 이후에만 설정.
- **예산:** `MAX_API_CALLS_PER_RUN` 기본 100, `MAX_API_CALLS_PER_DAY` 기본 1000. 재시도와 모든 페이지에 동일하게 적용됩니다.
- **중요:** GitHub 예약 실행은 정확한 5분 간격을 보장하지 않습니다. 누락 시 전체 수집이 일어나며 실제 상태가 확인된 10분을 초과하면 현재 충전 가능으로 표시하지 않습니다.
- **중요:** 요청이 많아 1일 호출 예산을 소진하면 데이터를 보존하고 경고를 남기며, 날짜가 바뀐 뒤 전체 재동기화를 시도합니다. 상시 실시간 SLA가 필요하다면 영속 디스크를 가진 전용 서버에 동일 수집기를 배포해야 합니다.

## 4. CLI

```bash
python3 scripts/collect.py --mode full
python3 scripts/collect.py --mode auto
python3 scripts/collect.py --mode status --period 10
python3 scripts/collect_fees.py
npm run check
npm test
npm run build
npm run verify:deployment -- https://softm.github.io/evchargingstation/
```

배포 파일 `fees.json`에는 실제 이용단가라고 주장하지 않는 `reference`/사용허가 `licensed_publisher` 등의 출처 유형을 표시합니다. 충전기별 실거래가는 신용카드·로밍·프로모션에 따라 달라질 수 있습니다.

## 5. 검증 완료 기준

1. API 전체 페이지에서 정합성 확인, `totalStations` 및 `totalChargers`와 16개 지역 합계 일치.
2. 공개 JSON의 `facilityKind`, `floorNumber`, `manufacturer` 등 신규 필드와 `dataCompleteness` 수치 확인.
3. 압축 파일 모든 경로가 현재 매니페스트에 연결되고 해제 후 JSON 스키마/건수가 일치.
4. 상태수집 실패 후 기존 자료를 덮어쓰거나 상태의 확인 시각을 임의로 늘리지 않음.
5. 요금 자료 수집 실패·사용허가 미확인 시 기존 요금표 보존. 실제 가격이 아닌 안내가로 표시.
6. 요금 원본·운영기관 ID를 정확히 일치시켜 병합. 유사한 이름만 보고 가격을 붙이지 않음.
7. 실제 UI에서 지역 검색·지도 마커·시설 상세 및 요금 출처 링크 표시 확인.
