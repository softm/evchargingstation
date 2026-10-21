import {getCache} from '@vercel/functions';
import {readFileSync} from 'node:fs';
import {createStatusService,StatusError} from '../lib/status-service.js';

const registry = JSON.parse(readFileSync(new URL('../lib/stations.json',import.meta.url),'utf8'));
const service = createStatusService({registry,cache:getCache(),serviceKey:process.env.DATA_GO_KR_SERVICE_KEY,
  maxCalls:Math.min(1000,Math.max(1,Number(process.env.MAX_STATUS_CALLS_PER_INSTANCE_PER_DAY)||200))});
const origins = new Set(['https://softm.github.io',...(process.env.EV_ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean)]);

export async function GET(request) {
  const origin = request.headers.get('origin');
  const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  if (origin && !origins.has(origin)) return Response.json({schemaVersion:1,code:'ORIGIN_DENIED'},{status:403,headers});
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  const url = new URL(request.url);
  try {
    if (url.pathname === '/api/health') return Response.json(await service.health(),{headers});
    if (url.pathname !== '/api/status') throw new StatusError('NOT_FOUND',404);
    if ([...url.searchParams.keys()].some(k=>!['stationId','region'].includes(k)) || [...url.searchParams].length !== 2) throw new StatusError('INVALID_REQUEST',400);
    return Response.json(await service.station(url.searchParams.get('stationId') || '',url.searchParams.get('region') || ''),{headers});
  } catch (error) {
    const code = error instanceof StatusError ? error.code : 'SERVER_ERROR';
    if (!(error instanceof StatusError)) console.error('EV status handler failed',{code});
    return Response.json({schemaVersion:1,code,retryAfterSeconds:code === 'UNCONFIGURED' ? 300 : 60},{status:error instanceof StatusError ? error.status : 500,headers});
  }
}
