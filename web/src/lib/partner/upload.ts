import type { TempMediaResponse } from '@/lib/api/types';
import { messageForEstablishmentError } from '@/lib/partner/errors';

/** Russify an upload failure by backend code; a raw 413 is the Railway edge cap. */
function uploadFailure(
  code: string | undefined,
  status: number,
): { ok: false; message: string } {
  return {
    ok: false,
    message: messageForEstablishmentError(
      code ?? (status === 413 ? 'HTTP_413' : undefined),
    ),
  };
}

/*
 * Client-side media upload helper (Phase C Slice 1, Segment B). Posts a single
 * file to the web streaming proxy (/api/partner/media), which injects the Bearer
 * server-side and forwards to the backend temp-upload. Returns the Cloudinary
 * URLs for the form to materialize on create. NOT a Server Action — multipart
 * uploads (esp. the 60MB PDF) must traverse the Route Handler, not a 1MB-capped
 * Server Action.
 */

export type UploadResult =
  | { ok: true; media: TempMediaResponse }
  | { ok: false; message: string };

export async function uploadMedia(
  file: File,
  type: 'interior' | 'menu',
): Promise<UploadResult> {
  const fd = new FormData();
  // Field order mirrors the backend multer expectation: `type` then `file`.
  fd.append('type', type);
  fd.append('file', file);

  try {
    const res = await fetch('/api/partner/media', { method: 'POST', body: fd });
    const json = (await res.json().catch(() => null)) as
      | {
          success?: boolean;
          data?: TempMediaResponse;
          error?: { message?: string; code?: string };
        }
      | null;

    if (!res.ok || !json?.success || !json.data) {
      return uploadFailure(json?.error?.code, res.status);
    }
    return { ok: true, media: json.data };
  } catch {
    return {
      ok: false,
      message: 'Не удалось загрузить файл. Проверьте подключение.',
    };
  }
}

/**
 * Attach media to an EXISTING establishment (edit mode) — POST /:id/media, the
 * only path that attaches a PDF post-create AND enqueues its OCR (Q1). Returns a
 * TempMediaResponse-shaped result; the backend media record fields are mapped
 * defensively (url is the contract; the rest fall back to it).
 */
export async function uploadMediaToEstablishment(
  file: File,
  establishmentId: string,
  type: 'interior' | 'menu',
): Promise<UploadResult> {
  const fd = new FormData();
  fd.append('type', type);
  fd.append('file', file);

  try {
    const res = await fetch(
      `/api/partner/establishments/${encodeURIComponent(establishmentId)}/media`,
      { method: 'POST', body: fd },
    );
    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      data?: Partial<TempMediaResponse>;
      error?: { message?: string; code?: string };
    } | null;

    if (!res.ok || !json?.success || !json.data?.url) {
      return uploadFailure(json?.error?.code, res.status);
    }
    // Accessed directly (not via an alias) so json.data.url stays narrowed to string.
    return {
      ok: true,
      media: {
        url: json.data.url,
        thumbnail_url: json.data.thumbnail_url ?? json.data.url,
        preview_url: json.data.preview_url ?? json.data.url,
        public_id: json.data.public_id ?? '',
        file_type: json.data.file_type ?? 'pdf',
      },
    };
  } catch {
    return {
      ok: false,
      message: 'Не удалось загрузить файл. Проверьте подключение.',
    };
  }
}
