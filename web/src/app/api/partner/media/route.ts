import { proxyMediaUpload } from '@/lib/partner/media-proxy';

/*
 * Partner media TEMP-upload proxy (Phase C Slice 1, Segment B — Decision 2).
 * Streams the raw multipart body to the backend temp-upload (before an
 * establishment exists), Bearer injected server-side. See media-proxy.ts for the
 * streaming/refresh mechanics and the named 60MB Railway edge-cap risk.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request): Promise<Response> {
  return proxyMediaUpload(request, '/api/v1/partner/media/upload');
}
