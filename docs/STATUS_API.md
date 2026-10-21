# 충전소 직접 상태 조회 서버

GitHub Pages의 gzip 시설·전국 검색 자료는 그대로 사용한다. 별도 Vercel Functions 서버가 상세 화면에서 선택한 충전소만 한국환경공단 `getChargerInfo`로 조회한다. 변경분 API의 빈 응답을 충전소 전체 정상 확인으로 해석하지 않는다.

- 프로젝트: `evchargingstation-status`, 루트: `services/status-api`, Node 24, 서울 `icn1`.
- `GET /api/status?stationId=NT100483&region=51`: 전체 응답 건수·충전소·지역·운영사·충전기 ID 중복 검증 후 상태와 원본 확인 시각만 반환한다. 사이트에 게시된 충전소 등록부에 없는 ID는 API를 호출하지 않는다.
- `GET /api/health`: 인증 설정 유무, 캐시 상태, 최근 실제 조회 결과, 확인 시각을 제공한다. 키와 원본 오류 내용은 반환하지 않는다. `ready`는 최근 충전기 상태 확인 성공을 뜻하지 않는다.
- API 인증키는 Vercel 프로젝트의 **Production 환경변수 `DATA_GO_KR_SERVICE_KEY`**에 등록하고 재배포한다. GitHub Actions Secret은 자동으로 Vercel에 전달되지 않는다. 키를 소스·공개 설정·채팅에 붙여 넣지 않는다.
- 공개 주소 설정: `PUBLIC_EV_STATUS_API_BASE_URL` / `EV_CONFIG.statusApiBaseUrl`. 시설 데이터 주소와 별개다. 기본 허용 Origin은 `https://softm.github.io`; 추가 개발 Origin은 서버 `EV_ALLOWED_ORIGINS`에서 쉼표로 구분한다.
- UI는 상세가 열려 있는 동안 60초마다 확인한다. 수동 버튼도 같은 브라우저 쿨다운을 적용한다. 서버 공유 Runtime Cache의 성공 결과는 120초 재사용하며 `observedAt`을 다시 찍지 않는다. 실패하면 마지막 정상 자료를 유지한다.
- 성공 캐시는 24시간 보관하되 120초 이상이면 새 원본 조회가 필요하다. 전송 장애·인증·한도 오류 시 공유 회로 차단을 적용한다. 한 인스턴스에서 동시 원본 조회는 최대 2개, KST 하루 최대 200회(환경변수 `MAX_STATUS_CALLS_PER_INSTANCE_PER_DAY`, 최대 1000)다. **인스턴스 상한은 전역 일일 예산이 아니다.** 캐시와 회로 차단도 강한 원자적 전역 쿼터가 아니다. 제공기관이 키 전체 한도를 최종 적용한다. 기존 Actions 수집과 동일 키를 쓰면 그 한도도 공유한다. 대규모 운영에서는 운영계정 한도와 영속 원자적 예산 저장소가 필요하다.
- Vercel에 임시 파일로 키·예산을 저장하지 않는다. Runtime Cache 장애 시 원본 호출을 막고 명확한 오류를 반환한다.
- 빌드 시 실제 게시된 전국 검색 파일을 받아 허용 충전소 등록부를 생성한다. 전국 등록부 변경은 서버 재배포 때 반영된다. 등록부와 생성 HTML은 git에 넣지 않는다.

검사: `npm ci --prefix services/status-api --ignore-scripts`, `npm run check`, `npm test`, `npm run build`, `npm run build --prefix services/status-api`. 인증키 없이 준비 상태와 안전한 실패 처리를 검증할 수 있다. 실제 연결 완료 판정에는 현재 원본 응답·갱신된 개별 확인 시각·화면 집계 확인이 필요하다.

근거: [공공데이터포털 및 v1.25 활용가이드](https://www.data.go.kr/data/15076352/openapi.do), [Vercel Node Functions](https://vercel.com/docs/functions/runtimes/node-js), [Runtime Cache](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
