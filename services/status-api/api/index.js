import {getCache} from '@vercel/functions';
import {readFileSync} from 'node:fs';
import {createStatusService} from '../lib/status-service.js';
import {createHandler} from '../lib/http.js';

const registry = JSON.parse(readFileSync(new URL('../lib/stations.json',import.meta.url),'utf8'));
const service = createStatusService({registry,cache:getCache(),serviceKey:process.env.DATA_GO_KR_SERVICE_KEY,
  maxCalls:Math.min(1000,Math.max(1,Number(process.env.MAX_STATUS_CALLS_PER_INSTANCE_PER_DAY)||200))});
const origins = new Set(['https://softm.github.io',...(process.env.EV_ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean)]);

export const GET = createHandler(service,origins);
