import type { TempMediaResponse } from '@/lib/api/types';

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
      | { success?: boolean; data?: TempMediaResponse; error?: { message?: string } }
      | null;

    if (!res.ok || !json?.success || !json.data) {
      return {
        ok: false,
        message: json?.error?.message ?? `Ошибка загрузки (${res.status}).`,
      };
    }
    return { ok: true, media: json.data };
  } catch {
    return {
      ok: false,
      message: 'Не удалось загрузить файл. Проверьте подключение.',
    };
  }
}
