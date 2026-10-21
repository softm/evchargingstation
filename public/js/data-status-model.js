const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function summarizeCollection(manifest, now = Date.now()) {
  const regions = manifest.regions || [];
  const stationTotal = count(manifest.totalStations);
  const chargerTotal = count(manifest.totalChargers);
  const sum = field => regions.every(region => count(region[field]) !== null)
    ? regions.reduce((total, region) => total + region[field], 0) : null;
  const hasData = stationTotal > 0 && regions.length > 0 && Boolean(manifest.generatedAt);
  const coverage = Date.parse(manifest.statusCoverageAt);
  const threshold = (Number(manifest.freshnessThresholdSeconds) || 600) * 1000;
  const statusFresh = hasData && Number.isFinite(coverage) && coverage <= now + 60000 && now - coverage <= threshold;
  const problems = [];
  if (stationTotal !== sum('stationCount')) problems.push('전체 충전소 수와 지역별 합계가 일치하지 않거나 확인할 수 없습니다.');
  if (chargerTotal !== sum('chargerCount')) problems.push('전체 충전기 수와 지역별 합계가 일치하지 않거나 확인할 수 없습니다.');
  if (stationTotal > 0 && !manifest.generatedAt) problems.push('수집 결과 생성 시각이 없습니다.');
  if (regions.some(region => region.complete === false)) problems.push('일부 지역의 수집이 완료되지 않았습니다.');
  if (manifest.searchIndex && (manifest.searchIndex.stationCount !== stationTotal || manifest.searchIndex.chargerCount !== chargerTotal)) problems.push('전국 검색 자료와 수집 결과의 건수가 일치하지 않습니다.');
  const original = count(manifest.regionStorage?.originalBytes);
  const published = count(manifest.regionStorage?.publishedBytes);
  const saving = original > 0 && published !== null && published <= original ? (1 - published / original) * 100 : null;
  return { hasData, statusFresh, stationTotal, chargerTotal, regionCount: regions.length,
    original, published, saving, problems, collectedAt: manifest.inventoryUpdatedAt || manifest.generatedAt || null };
}

export function verifyRegionCounts(entry, region) {
  const stations = region.stations.length;
  const chargers = region.stations.reduce((total, station) => total + (station.chargers || []).length, 0);
  const complete = region.complete !== false;
  return { stations, chargers, valid: complete && stations === entry.stationCount && chargers === entry.chargerCount };
}
