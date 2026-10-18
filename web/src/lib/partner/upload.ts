import type { TempMediaResponse } from '@/lib/api/types';
import { refusalMessage } from '@/lib/partner/errors';

/** When a refused upload may be tried again, as the backend names it. */
type RetryTerm = { retryAfter?: number; resetAt?: string };

const positiveWhole = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

/**
 * The term of a refusal that names one — the account's daily upload allowance
 * and the request limiter both answer 429 with it: seconds in
 * `error.details.retry_after` and in the Retry-After header the proxy passes
 * on, the moment in `error.details.reset_at`. The body wins; the header covers
 * a body without details, and only as whole seconds (an HTTP-date is not
 * read). A refusal without a term gets none. Carried for the cabinet to show;
 * the message is unchanged. Which limit refused is in the code and details,
 * not in the term.
 */
function retryTermOf(
  res: Response,
  details: { retry_after?: unknown; reset_at?: unknown } | undefined,
): RetryTerm {
  const term: RetryTerm = {};
  const header = res.headers.get('retry-after');
  const retryAfter =
    positiveWhole(details?.retry_after) ??
    positiveWhole(header !== null && /^\d+$/.test(header) ? Number(header) : undefined);
  if (retryAfter !== undefined) term.retryAfter = retryAfter;
  if (typeof details?.reset_at === 'string') term.resetAt = details.reset_at;
  return term;
}

type UploadErrorBody = {
  message?: string;
  code?: string;
  details?: { retry_after?: unknown; reset_at?: unknown; files_limit?: unknown };
};

/**
 * Word an upload failure (lib/partner/errors refusalMessage): the daily
 * allowance and the request limiter with their term, the server's Russian
 * text as is, else by code; a raw 413 is the Railway edge cap.
 */
function uploadFailure(
  res: Response,
  body: { message?: string; error?: UploadErrorBody } | null,
): { ok: false; message: string } & RetryTerm {
  const error = body?.error;
  const code = error?.code ?? (res.status === 413 ? 'HTTP_413' : undefined);
  const term = retryTermOf(res, error?.details);
  return {
    ok: false,
    message: refusalMessage({
      code,
      // The backend's text is at the top level (errorHandler.js); the proxy's
      // own refusals (media-proxy jsonError) put it under `error`.
      message: error?.message ?? body?.message,
      retryAfter: term.retryAfter,
      limit:
        code === 'RATE_LIMIT_EXCEEDED'
          ? error?.details?.files_limit !== undefined
            ? 'daily_uploads'
            : 'requests'
          : undefined,
    }),
    ...term,
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
  | ({ ok: false; message: string } & RetryTerm);

/*
 * Pre-flight extension check, mirroring the backend allow-list (temp-upload +
 * media routes). The browser-supplied mimetype comes from OS file associations
 * — a PDF-compatible .ai file can report application/pdf and pass an accept
 * filter — so the file NAME extension is the client-side signal. The backend
 * re-checks authoritatively; this only saves the round-trip and phrases the
 * rejection in Russian immediately.
 */
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|heic|jfif)$/i;
const PDF_EXT_RE = /\.pdf$/i;

export function validateMediaFileName(
  name: string,
  kind: 'photo' | 'pdf',
): string | null {
  if (kind === 'pdf') {
    return PDF_EXT_RE.test(name)
      ? null
      : `Файл «${name}» не является PDF. Меню можно загрузить как PDF или фото JPG/PNG/WebP.`;
  }
  return IMAGE_EXT_RE.test(name)
    ? null
    : `Недопустимый формат файла «${name}». Допустимы фото JPG, PNG, WebP или HEIC.`;
}

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
          message?: string;
          data?: TempMediaResponse;
          error?: UploadErrorBody;
        }
      | null;

    if (!res.ok || !json?.success || !json.data) {
      return uploadFailure(res, json);
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
      message?: string;
      data?: Partial<TempMediaResponse>;
      error?: UploadErrorBody;
    } | null;

    if (!res.ok || !json?.success || !json.data?.url) {
      return uploadFailure(res, json);
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
