# 구현과 배포 검증 기록

## 2026-10-20 — 최초 전국 실데이터 수집 및 gzip 전송 구조

- 공식 승인키 수정 후 전국 53페이지·API 53회로 충전소 **100,497곳**, 충전기 **522,849대**를 실제 수집했다.
- [최초 수집 성공 로그](https://github.com/softm/evchargingstation/actions/runs/39348930525)는 수집과 빌드는 성공했으나, 같은 워크플로 재실행에 `github-pages` 아티팩트가 2개 생성되어 게시가 실패했다.
- [고유 아티팩트명 수정본 배포](https://github.com/softm/evchargingstation/actions/runs/39363450494)는 수집·빌드·GitHub Pages 배포가 모두 성공했다. 빌드 기준 저장된 총계는 동일하다.
- 새 정적 빌드에서는 지역별 원본 JSON의 전송용 파일을 `.json.gz`로 압축하도록 구현했다. `scripts/compress-data.mjs`, `public/js/data.js`, `scripts/verify-deployment.mjs`, `tests/compression.test.mjs`를 확인한다.
- gzip 구조의 실제 운영 게시 여부와 압축률 수치는 별도 배포 실행 이후 검증 결과를 업데이트한다. 원본 데이터는 바꾸지 않으며, 자동 상태 갱신은 활성화하지 않았다.

---

## 2026-10-20 — 실제 API 인증 오류 진단과 배포 정책 보완

검증 대상은 [`cf3f55e66612aae2613fcb54e9080bb94ddef980`](https://github.com/softm/evchargingstation/commit/cf3f55e66612aae2613fcb54e9080bb94ddef980)의 배포본입니다. 아래의 이전 시각별 기록은 당시 결과이며, 현재 상태는 이 절을 기준으로 확인합니다.

| 항목 | 확인 결과 | 근거 |
| --- | --- | --- |
| 자동 검사 | `npm run check`, `npm test`, `npm run build` 통과. JavaScript 19개 + Python 26개 = 45개 테스트 | 로컬 검사와 [진단 배포 실행 39347686696](https://github.com/softm/evchargingstation/actions/runs/39347686696) |
| 최초 `full` 수집 | 실제 수집 단계가 HTTP 403으로 실패. 당시 `continue-on-error` 설정 때문에 워크플로 전체 성공과 수집 성공이 일치하지 않았음 | [실행 39342978479](https://github.com/softm/evchargingstation/actions/runs/39342978479) |
| 오류 진단 | HTTP 403 본문을 제한된 크기로 읽고 알려진 제공기관 오류코드만 안전하게 분류하여 코드 `30` 확인. 응답 원문이나 인증정보는 기록하지 않음 | [진단 배포 실행 39347686696](https://github.com/softm/evchargingstation/actions/runs/39347686696) |
| 공식 포털 미리보기 | `getChargerInfo` 미리보기는 결과코드 `00` / `NORMAL SERVICE.`로 실제 충전기 10건을 반환. GitHub에 저장된 키로 실행한 수집과 결과가 달라 Secret 값 재확인이 필요 | 공공데이터포털의 해당 API 활용신청 상세 화면에서 실행한 공식 미리보기. 인증키가 포함된 요청 주소는 기록하지 않음 |
| 수동 전체 수집의 배포 조건 | 명시적 `workflow_dispatch` + `collection_mode: full`에서는 수집 설정 활성 및 수집 단계 성공을 모두 요구. 충족하지 않으면 캐시 보존 후 오류로 종료하고 신규 배포 중단 | [수집·배포 워크플로](https://github.com/softm/evchargingstation/blob/cf3f55e66612aae2613fcb54e9080bb94ddef980/.github/workflows/collect-and-deploy.yml) |
| 코드 배포와 데이터 운영 | 진단 수정본 배포 완료. 실제 충전소 데이터 수집은 인증 오류로 미완료이며 예약 수집·자동 갱신은 비활성 | [진단 배포 실행 39347686696](https://github.com/softm/evchargingstation/actions/runs/39347686696) |

남은 작업은 인증 오류를 해결한 뒤 `full` 수집을 성공시키고 실제 목록·상태·확인 시각을 원본과 대조하는 것입니다. 정상 데이터 검증 후 예약 수집을 활성화합니다. `push`, 수동 `auto`, 예약 실행은 수집 실패 시 기존 snapshot과 확인 시각을 보존하면서 UI 배포를 계속할 수 있습니다. 앱 배포 성공을 실데이터 수집 성공으로 해석하지 않습니다.

## 2026-10-20 08:19 KST — 수정본 배포 검증

검증 대상은 [`74f9fefa8b0580f56c83a5a1ed2a1a168812e46f`](https://github.com/softm/evchargingstation/commit/74f9fefa8b0580f56c83a5a1ed2a1a168812e46f)의 배포본입니다. 게시 주소 검증기의 `verifiedAt`은 `2026-10-19T23:19:16.447Z`이며, 한국시간으로 2026-10-20 08:19:16.447입니다.

| 항목 | 확인 결과 | 근거 |
| --- | --- | --- |
| GitHub Actions 배포 | `completed` / `success` | [실행 39340656280](https://github.com/softm/evchargingstation/actions/runs/39340656280) |
| 운영 주소 | 실제 HTTPS 요청 HTTP 200 | [충전한눈](https://softm.github.io/evchargingstation/), 게시 주소 검증기 실행 |
| 배포 소스 식별 | `sourceRevision`이 위 커밋과 일치, 단축값 `74f9fef` | [build-info.json](https://softm.github.io/evchargingstation/build-info.json) |
| 공개 데이터 | `mode: unconfigured`, 충전소 0곳·충전기 0기 | [manifest.json](https://softm.github.io/evchargingstation/data/manifest.json) |
| 자동 검사 | `npm run check`, `npm test`, `npm run build` 통과. JavaScript 19개 + Python 22개 = 41개 테스트, localhost HTTP 검사 포함 | 로컬 검사와 위 Actions 실행 |
| 모바일 화면 | 실제 브라우저의 390×844 화면에서 가로 넘침 없음 | 배포본 브라우저 확인 |
| 공유 링크와 상세 | `DEMO001` 공유 URL을 열면 해당 가상 충전소 상세가 자동으로 열림 | 배포본의 `?demo=1` 화면 체험 |
| 상세 알림 | 상세창의 예시 위치 버튼을 눌렀을 때 알림이 상세창 위 최상위 레이어에 표시됨 | 배포본 브라우저 확인 |
| 즐겨찾기 | 저장 후 버튼 포커스와 저장 개수 유지. 검증 후 저장을 해제하여 0개로 복원 | 배포본 브라우저 확인 |
| 검색 | `광화문` 검색 결과가 가상 충전소 1곳으로 좁혀짐 | 배포본의 `?demo=1` 화면 체험 |
| 브라우저 콘솔 | 확인한 시나리오에서 경고 0건·오류 0건 | 브라우저 콘솔 확인 |
| 실제 API 연결 | Repository/Environment Secret 없음. 실행 환경에 서비스키 없음. 공공데이터포털 로그아웃 상태 확인. 실제 API 호출 미수행 | 비밀 설정 존재 여부와 실행 환경·포털 확인 |

08:19 기준으로 사이트 게시와 위 배포본의 화면 검증은 완료했습니다. 당시 데이터 운영의 미해결 조건은 실제 공공데이터 인증키 연결이었으며, 아래 작업을 남겨 두었습니다.

### 당시 남은 데이터 운영 확인

| 순서 | 작업 | 완료 기준 |
| --- | --- | --- |
| 1 | [Actions Secrets](https://github.com/softm/evchargingstation/settings/secrets/actions)에 `DATA_GO_KR_SERVICE_KEY` 등록 | 한국환경공단 전기자동차 충전소 정보 활용이 승인된 인증키를 비공개 설정에 연결 |
| 2 | [수집·배포 워크플로](https://github.com/softm/evchargingstation/actions/workflows/collect-and-deploy.yml)를 `collection_mode: full`로 실행 | 실제 API 응답의 모든 페이지 수집과 실제 충전소·충전기 데이터 게시 성공 |
| 3 | 실제 응답 검증 | 충전소 수·충전기 ID·좌표·상태·변경 시각·시간대·코드를 원본과 대조하고 승인 호출 한도 확인 |
| 4 | 검증된 데이터의 예약 수집 활성화 | [Actions Variables](https://github.com/softm/evchargingstation/settings/variables/actions)에 `ENABLE_SCHEDULED_COLLECTION=true` 설정 후 갱신 간격·누락·쿼터 관찰 |

체험 화면의 충전소와 상태는 가상 데이터입니다. 위 배포 검증은 실제 서비스키를 사용한 API 호출이나 실데이터 수집 성공을 뜻하지 않습니다.

## 2026-10-20 01:36~01:42 KST — 선행 검증 기록

한국시간 01:36~01:42 확인 기준입니다. 초기 장애 기록은 아래에 보존합니다.

| 항목 | 확인 결과 |
| --- | --- |
| 운영 루트·배포 정보·manifest | 실제 HTTPS 요청 모두 HTTP 200 |
| Pages 설정 | Source가 GitHub Actions이며 `Collect and deploy EV charging stations`가 마지막 게시 워크플로 |
| 공개 배포 내용 | `build-info.json`의 초기 구현 커밋 `0e844420a55fa827db833019448c13d417db97da` 확인 |
| 기본 화면 | 데이터 연결 준비·충전소 0건, 네이버 지도 정상 표시 |
| 체험 화면 | 명시된 가상 충전소 8곳, 목록·번호 마커·상세 화면 확인, 브라우저 오류 로그 없음 |
| 수정 후 자동 검사 | JavaScript 19개 + Python 22개 = 41개 통과. localhost HTTP 검사 포함 |
| 실제 데이터 설정 | Repository/Environment Secret 없음. 공공데이터포털은 로그아웃 상태. 실제 API 호출 미수행 |

이번 보완은 공유 링크의 중심·배율 보존, 초기 지도 준비 순서, 갱신 중 선택 충전소 삭제 처리, 상세창의 알림·포커스·스크롤 유지, 검색 초기화 타이머 취소를 포함합니다. 수집기는 완료 시각까지 변경분 조회창이 겹치는지 검사하고 상태값·변경 시각이 불완전한 응답은 기존 확인 시각을 갱신하지 않습니다.

게시 주소를 직접 검증하는 `scripts/verify-deployment.mjs`를 추가했습니다. 초기 공개 배포에서 검사의 정상 통과를 확인했으며 이후 배포 워크플로도 동일 검사를 수행합니다. 이 시점 이후 수정본의 배포와 추가 화면 검증 결과는 상단의 08:19 KST 기록에 반영했습니다.

## 초기 구현 검증

확인 기준: 2026-10-19 16:15 UTC. 이 절은 해당 시점의 결과와 당시 잔여 작업을 보존한 기록입니다. 현재 배포 상태와 잔여 작업은 상단의 최신 검증 기록을 기준으로 확인합니다.

구현 commit: [`0e844420a55fa827db833019448c13d417db97da`](https://github.com/softm/evchargingstation/commit/0e844420a55fa827db833019448c13d417db97da)

### 초기 시점에 확인한 결과

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| JavaScript 문법·파일 계약 | 통과 | `npm run check`, 12개 JS 모듈과 JSON·HTML 리소스 검사 |
| 충전기 도메인 테스트 | 8개 통과 | 동일 충전기 조건, 확인 시각, 상태·커넥터 코드 |
| 지도 공통 함수 테스트 | 10개 통과 | 번호·좌표·마커 분산·목록 연동·표시 범위 |
| Python 수집기·서버 테스트 | 20개 통과 | JSON/XML·페이지·예산·부분 실패 보존·복구·실제 로컬 HTTP |
| 정적 앱 빌드 | 통과 | `npm run build`, 실제 데이터 미설정·충전소 0개 |
| GitHub CI | 위 38개 테스트 및 빌드 통과 | [build 작업 로그](https://github.com/softm/evchargingstation/actions/runs/39281896016/job/118157661364) |
| Pages 아티팩트 | 업로드 성공 | [github-pages 아티팩트](https://github.com/softm/evchargingstation/actions/runs/39281896016/artifacts/12200952515), 36,480바이트 |
| 로컬·원격 코드 | 동일 | 같은 tree SHA, 로컬 Git 객체 검사 통과 |

HTTP 테스트는 실제 로컬 소켓을 사용하는 통합 검사입니다. 공공 API 응답은 테스트용 fixture로 검사했으며, 실제 서비스키를 사용한 제공기관 호출 성공을 의미하지 않습니다.

아티팩트 SHA-256: `67dee2ce8d014dcadb6deb8f56e7807c182814d597dbba24b42ef7fac599ea68`.

### 초기 게시 단계의 외부 장애

[GitHub 공식 상태](https://www.githubstatus.com/)에서 2026-10-19 15:49 UTC부터 Actions·Pages 장애를 공지했습니다. 15:56 UTC 갱신에서는 Actions·Pages·Webhooks의 워크플로 처리·사이트 빌드·웹훅 전달 지연을 설명했습니다. [해당 장애 기록](https://www.githubstatus.com/incidents/8tzbpcnl75jp).

[배포 실행](https://github.com/softm/evchargingstation/actions/runs/39281896016)의 `queued` 메타데이터는 이미 완료된 build 로그와 불일치했습니다. 배포 job의 완료 로그는 확인되지 않았고, 별도 브라우저에서 공개 주소를 열었을 때 GitHub Pages의 `404 — There isn't a GitHub Pages site here`가 표시됐습니다. 따라서 **당시 사이트 게시 완료와 배포 후 화면 검증은 미완료**였습니다. 공식 장애와 관측된 배포 지연의 시간이 겹치지만, 특정 job의 내부 지연 원인까지 확정한 것은 아닙니다.

Pages Source를 GitHub Actions로 저장한 성공 응답은 확인했습니다. 초기 branch 방식의 dynamic 실행도 생성되어, 장애가 해소된 뒤 Source 설정의 유지와 최종 배포 결과를 다시 확인해야 합니다. 운영 설정은 [OPERATIONS.md](OPERATIONS.md)에 있습니다.

### 초기 확인 시점의 잔여 점검 — 과거 기록

아래 목록은 2026-10-19 16:15 UTC에 남아 있던 점검 사항입니다. 이후 확인을 완료한 배포·화면 항목과 현재 남은 데이터 운영 항목은 상단 기록에 구분하여 반영했습니다.

1. [Pages 설정](https://github.com/softm/evchargingstation/settings/pages)에서 Source가 GitHub Actions인지 확인하고, 위 배포 실행이 완료된 뒤 앱 주소가 열리는지 확인합니다. 실패로 끝난 경우 해당 실패 작업을 재실행합니다.
2. 기본 화면에서 실제 데이터 미설정 안내를 확인하고, `?demo=1`에서만 가상 8개 충전소·17개 충전기가 나오는지 확인합니다.
3. 실제 지도 SDK 인증 및 대체 지도, 지도·목록 번호 연동, 상세 닫기, 검색·필터·즐겨찾기·공유, 모바일 배치와 위치 권한 거절을 브라우저에서 확인합니다. 이 항목들은 코드와 순수 함수 검사를 마쳤으나 배포 화면의 수동 검증은 아직 수행하지 못했습니다.
4. `DATA_GO_KR_SERVICE_KEY`를 Actions Secret에 등록하고 `collection_mode: full`로 수집합니다. 실제 응답의 시간대·페이지 수·충전소 수·좌표·코드와 제공기관 상태를 대조합니다.
5. 전체 수집이 정상임을 확인한 뒤 `ENABLE_SCHEDULED_COLLECTION=true`를 설정합니다. 예약 실행 지연과 호출 한도는 계속 관찰해야 합니다.

인증키는 저장소·브라우저 공개 설정에 포함되어 있지 않았습니다. 당시 기본 화면용 manifest는 `mode: unconfigured`였으며, 실데이터 수집 성공이나 충전 가능 상태를 주장하지 않았습니다.

저장소 반영 결과는 [evchargingstation](https://github.com/softm/evchargingstation)에서 확인할 수 있습니다.
