import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/app.ts';

const API_PREFIX = '/api';

/**
 * Vercel serves every `/api/*` request through this single function (see the
 * rewrite in `vercel.json`). Depending on how the platform applies that
 * rewrite, the handler can be invoked with any of these URLs:
 *
 *   - `/api/health`            the original request path (most common)
 *   - `/api?__path=/health`    the destination, with the path carried in a query
 *   - `/health`                the prefix stripped from the original path
 *
 * The Express app only routes on `/api/...`, so normalise all three shapes back
 * into the original URL before dispatching.
 */
export function restoreApiPath(rawUrl: string | undefined): string {
  const url = rawUrl || '/';
  const queryIndex = url.indexOf('?');
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const query = new URLSearchParams(queryIndex === -1 ? '' : url.slice(queryIndex + 1));

  const carried = query.get('__path');
  if (carried !== null) {
    query.delete('__path');
    const suffix = carried === '' || carried === '/' ? '' : carried.startsWith('/') ? carried : `/${carried}`;
    return `${API_PREFIX}${suffix}${withQuery(query)}`;
  }

  if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) return url;

  const suffix = pathname === '/' ? '' : pathname;
  return `${API_PREFIX}${suffix}${withQuery(query)}`;
}

function withQuery(query: URLSearchParams): string {
  const rest = query.toString();
  return rest ? `?${rest}` : '';
}

/**
 * Wraps the Express app as a Vercel function handler. One Express app (and so
 * one pg pool) per lambda instance, created lazily on first query and reused
 * across warm invocations.
 */
export function createApiHandler(app = createApp()) {
  return function handler(req: IncomingMessage, res: ServerResponse): void {
    req.url = restoreApiPath(req.url);
    app(req as never, res as never);
  };
}

export default createApiHandler();
