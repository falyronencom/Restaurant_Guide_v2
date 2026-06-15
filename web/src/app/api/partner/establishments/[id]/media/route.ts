import { proxyMediaUpload } from '@/lib/partner/media-proxy';

/*
 * Establishment-scoped media proxy (Phase C Slice 1, Segment B). Streams a
 * multipart upload to the backend POST /:id/media — the ONLY path that attaches
 * a PDF to an existing establishment (PUT media-sync ignores menu_pdfs — Q1) and
 * that enqueues OCR for it. Used for PDF-add-in-edit.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return proxyMediaUpload(
    request,
    `/api/v1/partner/establishments/${encodeURIComponent(id)}/media`,
  );
}
