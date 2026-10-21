import {StatusError} from './status-service.js';

export function createHandler(service, origins) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
    if (origin && !origins.has(origin)) return Response.json({schemaVersion:1,code:'ORIGIN_DENIED'},{status:403,headers});
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return Response.json(await service.health(),{headers});
      if (url.pathname !== '/api/status') throw new StatusError('NOT_FOUND',404);
      // Vercel's /api/:path* rewrite also supplies the matched `path` query.
      // It is routing metadata, never a parameter forwarded to the provider.
      const pairs = [...url.searchParams].filter(([key,value])=>key !== 'path' || value !== 'status');
      if (pairs.length !== 2 || pairs.some(([key])=>!['stationId','region'].includes(key))
        || !url.searchParams.has('stationId') || !url.searchParams.has('region')) throw new StatusError('INVALID_REQUEST',400);
      return Response.json(await service.station(url.searchParams.get('stationId'),url.searchParams.get('region')),{headers});
    } catch (error) {
      const code = error instanceof StatusError ? error.code : 'SERVER_ERROR';
      if (!(error instanceof StatusError)) console.error('EV status handler failed',{code});
      return Response.json({schemaVersion:1,code,retryAfterSeconds:code === 'UNCONFIGURED' ? 300 : 60},{status:error instanceof StatusError ? error.status : 500,headers});
    }
  };
}
