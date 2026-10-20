// Fictitious stations are loaded ONLY by the explicit ?demo=1 experience.
export function createDemo() {
  const now = Date.now();
  const at = seconds => new Date(now - seconds * 1000).toISOString();
  const charger = (id, type, outputKw, status, seconds = 90) => ({ id, type, outputKw, method: '단독', status, observedAt: at(seconds), statusChangedAt: at(seconds + 240), lastStartedAt: null, lastEndedAt: null, currentStartedAt: null });
  const stations = [
    ['DEMO001', '예시 · 시청 공영 충전소', 37.5664, 126.9779, '중구', false, true, [charger('01', '04', 100, '2'), charger('02', '04', 100, '3'), charger('03', '02', 7, '2')]],
    ['DEMO002', '예시 · 광화문 급속 충전소', 37.5727, 126.9768, '종로구', false, false, [charger('01', '04', 200, '2'), charger('02', '10', 200, '2')]],
    ['DEMO003', '예시 · 덕수궁 주차장', 37.5652, 126.9731, '중구', false, null, [charger('01', '02', 7, '3'), charger('02', '02', 7, '3')]],
    ['DEMO004', '예시 · 종각 충전 라운지', 37.5704, 126.9831, '종로구', false, true, [charger('01', '09', 150, '6'), charger('02', '04', 100, '2')]],
    ['DEMO005', '예시 · 서울역 복합 충전소', 37.5563, 126.9747, '용산구', null, false, [charger('01', '06', 50, '9'), charger('02', '04', 50, '5')]],
    ['DEMO006', '예시 · 남산 전망 충전소', 37.5598, 126.9872, '중구', false, true, [charger('01', '04', 100, '2', 1800), charger('02', '04', 100, '3', 1800)]],
    ['DEMO007', '예시 · 충정로 업무시설', 37.5605, 126.9656, '서대문구', true, null, [charger('01', '02', 11, '2')]],
    ['DEMO008', '예시 · 을지로 충전 허브', 37.5661, 126.9917, '중구', false, true, [charger('01', '04', 350, '3'), charger('02', '04', 350, '2'), charger('03', '01', 50, '1')]],
  ].map(([id, name, lat, lng, district, restricted, parkingFree, chargers]) => ({ id, name, lat, lng, regionCode: '11', districtCode: '', address: `서울특별시 ${district} (체험용 가상 주소)`, detailAddress: '실제 방문 장소가 아닙니다', location: '예시 주차장 지상 1층', useTime: '24시간 이용가능', parkingFree, restricted, restrictionReason: restricted ? '시설 이용자 전용 (예시)' : '', note: '화면 체험을 위해 만든 가상 충전소입니다. 실제 충전소 정보와 무관합니다.', operatorId: 'DEMO', operatorName: '예시 충전 운영사', phone: '', chargers }));
  const region = { schemaVersion: 1, regionCode: '11', mode: 'demo', generatedAt: at(0), inventoryUpdatedAt: at(0), statusCoverageAt: null, complete: true, stations };
  const manifest = { schemaVersion: 1, mode: 'demo', generatedAt: at(0), inventoryUpdatedAt: at(0), statusCoverageAt: null, freshnessThresholdSeconds: 600, source: { name: '화면 체험용 가상 데이터', url: 'https://www.data.go.kr/data/15076352/openapi.do' }, totalStations: stations.length, totalChargers: stations.reduce((sum, station) => sum + station.chargers.length, 0), regions: [{ code: '11', name: '서울', path: 'regions/11.json', bounds: { south: 37.41, north: 37.72, west: 126.76, east: 127.19 }, stationCount: stations.length, chargerCount: stations.reduce((sum, station) => sum + station.chargers.length, 0) }], warnings: [] };
  return { manifest, region };
}
