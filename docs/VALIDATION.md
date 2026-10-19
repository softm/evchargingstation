# 초기 구현 검증 기록

확인 기준: 2026-10-19 16:15 UTC. 이 문서는 해당 시점의 결과를 기록합니다.

구현 commit: [`0e844420a55fa827db833019448c13d417db97da`](https://github.com/softm/evchargingstation/commit/0e844420a55fa827db833019448c13d417db97da)

## 확인한 결과

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

## 게시 단계의 외부 장애

[GitHub 공식 상태](https://www.githubstatus.com/)에서 2026-10-19 15:49 UTC부터 Actions·Pages 장애를 공지했습니다. 15:56 UTC 갱신에서는 Actions·Pages·Webhooks의 워크플로 처리·사이트 빌드·웹훅 전달 지연을 설명했습니다. [해당 장애 기록](https://www.githubstatus.com/incidents/8tzbpcnl75jp).

[배포 실행](https://github.com/softm/evchargingstation/actions/runs/39281896016)의 `queued` 메타데이터는 이미 완료된 build 로그와 불일치했습니다. 배포 job의 완료 로그는 확인되지 않았고, 별도 브라우저에서 공개 주소를 열었을 때 GitHub Pages의 `404 — There isn't a GitHub Pages site here`가 표시됐습니다. 따라서 **사이트 게시 완료와 배포 후 화면 검증은 미완료**입니다. 공식 장애와 관측된 배포 지연의 시간이 겹치지만, 특정 job의 내부 지연 원인까지 확정한 것은 아닙니다.

Pages Source를 GitHub Actions로 저장한 성공 응답은 확인했습니다. 초기 branch 방식의 dynamic 실행도 생성되어, 장애가 해소된 뒤 Source 설정의 유지와 최종 배포 결과를 다시 확인해야 합니다. 운영 설정은 [OPERATIONS.md](OPERATIONS.md)에 있습니다.

## 남아 있는 실제 환경 확인

1. [Pages 설정](https://github.com/softm/evchargingstation/settings/pages)에서 Source가 GitHub Actions인지 확인하고, 위 배포 실행이 완료된 뒤 앱 주소가 열리는지 확인합니다. 실패로 끝난 경우 해당 실패 작업을 재실행합니다.
2. 기본 화면에서 실제 데이터 미설정 안내를 확인하고, `?demo=1`에서만 가상 8개 충전소·17개 충전기가 나오는지 확인합니다.
3. 실제 지도 SDK 인증 및 대체 지도, 지도·목록 번호 연동, 상세 닫기, 검색·필터·즐겨찾기·공유, 모바일 배치와 위치 권한 거절을 브라우저에서 확인합니다. 이 항목들은 코드와 순수 함수 검사를 마쳤으나 배포 화면의 수동 검증은 아직 수행하지 못했습니다.
4. `DATA_GO_KR_SERVICE_KEY`를 Actions Secret에 등록하고 `collection_mode: full`로 수집합니다. 실제 응답의 시간대·페이지 수·충전소 수·좌표·코드와 제공기관 상태를 대조합니다.
5. 전체 수집이 정상임을 확인한 뒤 `ENABLE_SCHEDULED_COLLECTION=true`를 설정합니다. 예약 실행 지연과 호출 한도는 계속 관찰해야 합니다.

인증키는 저장소·브라우저 공개 설정에 포함되어 있지 않습니다. 현재 기본 화면용 manifest는 `mode: unconfigured`이며, 실데이터 수집 성공이나 충전 가능 상태를 주장하지 않습니다.

저장소 반영 결과는 [evchargingstation](https://github.com/softm/evchargingstation)에서 확인할 수 있습니다.
