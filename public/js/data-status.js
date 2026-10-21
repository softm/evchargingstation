import { DataClient } from './data.js';
import { summarizeCollection, verifyRegionCounts } from './data-status-model.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const client = new DataClient(window.EV_CONFIG || {});
const number = value => value === null || value === undefined ? '미확인' : Number(value).toLocaleString('ko-KR');
const bytes = value => value === null || value === undefined ? '미확인' : value < 1000 ? `${value} B` : value < 1e6 ? `${(value / 1000).toFixed(1)} KB` : `${(value / 1e6).toFixed(2)} MB`;
const time = value => !value || !Number.isFinite(Date.parse(value)) ? '미확인' : new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
let currentManifest;

async function buildInfo() {
  try {
    const response = await fetch('./build-info.json', {cache:'no-store',signal:AbortSignal.timeout(10000)});
    return response.ok ? await response.json() : {};
  } catch { return {}; }
}

function render(manifest, build, fees, attempt) {
  const result = summarizeCollection(manifest);
  const warnings = (manifest.warnings || []).map(warning => `수집 알림: ${warning.code || 'UNKNOWN'}`);
  const attemptLabel = attempt?.status === 'error' ? `실패 · ${attempt.code === 'NETWORK_ERROR' ? '수집 API 통신 오류' : '원본 수집 오류'}` : attempt?.status === 'success' ? '성공' : '기록 미등록';
  const problems = [...result.problems, ...warnings, ...(attempt?.status === 'error' ? [`최근 원본 수집 시도 ${attemptLabel}. 이전 정상 자료와 원래 확인 시각을 유지합니다.`] : [])];
  const notice = $('loadStatus');
  notice.className = `notice${problems.length || (result.hasData && !result.statusFresh) ? ' warning' : ''}`;
  notice.textContent = !result.hasData ? '아직 게시된 수집 데이터가 없습니다.' : problems.length ? '수집된 데이터를 표시합니다. 아래 확인 항목을 살펴보세요.' : result.statusFresh ? '수집 결과가 게시되어 있습니다. 최근 상태 수집 범위를 확인했습니다.' : '수집 결과가 게시되어 있습니다. 충전기 상태 갱신이 오래되어 현재 상태는 확인이 필요합니다.';
  const cards = [['충전소', result.stationTotal, '곳'], ['충전기', result.chargerTotal, '기'], ['수집 지역', result.regionCount, '개'], ['집계 대조', result.problems.length ? '확인 필요' : result.hasData ? '일치' : '대기', '']];
  $('dataSummary').innerHTML = cards.map(([label,value,unit]) => `<div class="metric"><p>${label}</p><strong>${typeof value === 'number' ? number(value) : esc(value ?? '미확인')}</strong><small>${unit}</small></div>`).join('');
  const schedule = typeof build.scheduledCollectionEnabled === 'boolean' ? build.scheduledCollectionEnabled ? '활성 · 5분 간격 예약 (실행 지연 가능)' : '비활성' : '설정 확인 불가';
  const details = [
    ['제공 방식', {snapshot:'수집 시점 스냅샷',live:'수집 서버 연결',unconfigured:'데이터 연결 준비',demo:'가상 예시'}[manifest.mode] || '미확인'],
    ['시설 전체 수집 완료', time(result.collectedAt)],
    ['결과 파일 생성', time(manifest.generatedAt)],
    ['상태 연속 수집 기준', time(manifest.statusCoverageAt)],
    ['충전기 상태 신선도', result.statusFresh ? '최근 수집 범위 확인 · 개별 충전기 상태는 상세에서 확인' : '현재 상태 재확인 필요'],
    ['예약 자동 수집', schedule],
    ['최근 원본 수집 시도', `${time(attempt?.attemptedAt)} · ${attemptLabel}`],
    ['화면 자동 확인', '1분마다 게시된 자료 확인 · 원본 수집 실행과 별개'],
    ['전국 검색 자료', manifest.searchIndex ? `${number(manifest.searchIndex.stationCount)}곳 · ${number(manifest.searchIndex.chargerCount)}기 · JSON.gz ${bytes(manifest.searchIndex.publishedBytes)}` : '아직 게시되지 않음'],
    ['사이트 배포', time(build.builtAt)],
    ['시간 기준', '한국 시간 (Asia/Seoul)'],
  ];
  $('collectionDetails').innerHTML = details.map(([label,value]) => `<dt>${label}</dt><dd>${esc(value)}</dd>`).join('');
  $('storageSummary').innerHTML = [['JSON 원본',bytes(result.original)],['게시 파일',bytes(result.published)],['전송 절감',result.saving === null ? '미확인' : `${result.saving.toFixed(1)}%`],['gzip 지역',`${number(manifest.regionStorage?.gzipRegions)} / ${number(result.regionCount)}`]].map(([label,value]) => `<p><span>${label}</span><strong>${esc(value)}</strong></p>`).join('');
  $('regionRows').innerHTML = manifest.regions.length ? manifest.regions.map((entry,index) => `<tr><td><a href="./?region=${encodeURIComponent(String(entry.code))}">${esc(entry.name)}</a></td><td>${number(entry.stationCount)}</td><td>${number(entry.chargerCount)}</td><td>${bytes(entry.originalBytes)}</td><td>${bytes(entry.compressedBytes)}</td><td>${entry.encoding === 'gzip' ? 'JSON.gz' : 'JSON'}</td><td><button type="button" data-region-index="${index}" aria-label="${esc(entry.name)} 파일 검사">파일 검사</button><span class="file-result" role="status">아직 검사하지 않음</span></td></tr>`).join('') : '<tr><td colspan="7">수집된 지역이 없습니다.</td></tr>';
  $('manifestLink').href = new URL('manifest.json', client.base).href;
  $('warningsPanel').hidden = !problems.length;
  $('warningsList').innerHTML = problems.map(problem => `<li>${esc(problem)}</li>`).join('');
  $('pageCheckedAt').textContent = `이 화면에서 결과를 읽은 시각: ${time(new Date().toISOString())}`;
  const rates = (fees?.operators || []).flatMap(operator => operator.rates || []);
  $('tariffSummary').innerHTML = fees ? `<p>연결 운영사 <strong>${number(fees.operators.length)}개</strong> · 회원 요금 항목 ${number(rates.filter(rate => rate.membership === 'member').length)}건 · 비회원 요금 항목 ${number(rates.filter(rate => rate.membership === 'nonmember').length)}건</p><p class="hint">출처: ${esc(fees.source?.name || '미확인')}<br>수집 확인 시각: ${time(fees.collectedAt)} · ${fees.collectedAt ? '요금표 확인 시각이며 실제 결제 보장이 아닙니다.' : '공표 기준 자료 · 자동 수집 확인 시각 미등록'}</p>` : '<p class="hint">요금 자료를 확인하지 못했습니다. 충전소·충전기 수집 결과는 위에서 확인하세요.</p>';
  $('statusContent').hidden = false;
}

async function refresh() {
  $('refreshStatus').disabled = true;
  $('regionRows').querySelectorAll('button').forEach(button => {button.disabled = true;});
  $('loadStatus').textContent = '게시된 수집 결과를 다시 확인하고 있습니다.';
  try {
    const [manifest, build, fees, attempt] = await Promise.all([client.manifest(), buildInfo(), client.fees().catch(() => null), client.collectionAttempt().catch(() => null)]);
    currentManifest = manifest;
    render(manifest, build, fees, attempt);
  } catch {
    $('loadStatus').className = 'notice error';
    $('loadStatus').textContent = currentManifest ? '최신 결과를 읽지 못했습니다. 아래에는 이전에 읽은 결과를 유지합니다. 현황 새로고침을 다시 눌러 주세요.' : '수집 결과를 읽지 못했습니다. 연결 상태를 확인하고 현황 새로고침을 눌러 주세요.';
    $('regionRows').querySelectorAll('button').forEach(button => {button.disabled = false;});
  } finally { $('refreshStatus').disabled = false; }
}

$('refreshStatus').addEventListener('click', refresh);
$('regionRows').addEventListener('click', async event => {
  const button = event.target.closest('button[data-region-index]');
  if (!button || button.disabled) return;
  const manifest = currentManifest;
  const entry = manifest?.regions[Number(button.dataset.regionIndex)];
  if (!entry) return;
  const output = button.nextElementSibling;
  button.disabled = true;
  output.className = 'file-result';
  output.textContent = '파일을 받아 해제하고 건수를 확인하는 중…';
  try {
    const region = await client.region(entry, {force:true});
    const result = verifyRegionCounts(entry, region);
    output.className = `file-result ${result.valid ? 'pass' : 'fail'}`;
    output.textContent = `${result.valid ? '일치' : '불일치 · 확인 필요'} · ${number(result.stations)}곳 / ${number(result.chargers)}기 · ${time(new Date().toISOString())}`;
  } catch {
    output.className = 'file-result fail';
    output.textContent = '파일을 읽거나 해제하지 못했습니다. 현황 새로고침 후 다시 검사해 주세요.';
  } finally { button.disabled = false; }
});
refresh();
