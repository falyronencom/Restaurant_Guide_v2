import type {
  EstablishmentStatus,
  PartnerEstablishmentDetail,
  PartnerEstablishmentListing,
  SessionUser,
} from '@/lib/api/types';
import type { Refusal } from '@/lib/partner/errors';
import type { PartnerMenu, PartnerMenuItem } from '@/lib/partner/menu';

/*
 * Partner cabinet operation result envelopes (CAT-C-3.14).
 *
 * Shared contract between the server operation layer (lib/partner/operations,
 * which produces them) and the client fetch layer (lib/partner/client, which
 * consumes the JSON the Route Handlers return). Kept in a neutral, client-safe
 * module: operations.ts is `server-only`, so a client island could not import
 * these types from it without tripping the server-only guard.
 *
 * The discriminated `ok` shape is UNCHANGED from the original Server Actions —
 * call sites branch on `r.ok` / `r.code`, so the transport move (Server Actions
 * → buffered POST Route Handlers, CAT-C-3.14) is invisible to them.
 */

/**
 * A refused operation: the code, plus — added 18.10.2026 (сверка находок
 * тестировщика с сайтом, С5, С6, Х17) — the server's Russian text and the
 * fields a field check named, for refusalMessage. Callers that read only
 * `code` are unaffected.
 */
export type Failure = { ok: false; code: string } & Omit<Refusal, 'code'>;

export type LoadEstablishmentsResult =
  | { ok: true; establishments: PartnerEstablishmentListing[] }
  | Failure;

export type CreateResult =
  | {
      ok: true;
      id: string;
      status?: EstablishmentStatus;
      base_score?: number | null;
      /** Re-stamped display user after the first create (role → partner), else unchanged. */
      user: SessionUser | null;
    }
  | Failure;

/**
 * What a cabinet write answers about the card's public page
 * (lib/partner/card-page.ts): dropped now, or not now — ask refresh-page in
 * `retryInMs` (the card's interval). Absent — the write does not touch a page
 * a guest sees.
 */
export type PageRefresh = {
  refreshed: boolean;
  retryInMs?: number;
};

export type WriteResult =
  | {
      ok: true;
      status?: EstablishmentStatus;
      base_score?: number | null;
      page?: PageRefresh;
      /** The card's public address, after a resume (for «Посмотреть на сайте»). */
      publicPath?: string;
    }
  | Failure;

export type LoadDetailResult =
  | {
      ok: true;
      establishment: PartnerEstablishmentDetail;
      /** The card's public address — a published card only, built on the site's server. */
      publicPath?: string;
    }
  | Failure;

/** The card's «Меню» section. */
export type MenuLoadResult =
  | {
      ok: true;
      menu: PartnerMenu;
      /**
       * The account's e-mail is not confirmed — asked of the account only when
       * a state a confirmed e-mail would help shows (T5); absent otherwise.
       */
      emailUnconfirmed?: boolean;
    }
  | Failure;

/** A menu line written (an edit, «Всё верно»). */
export type MenuItemWriteResult =
  | { ok: true; item: PartnerMenuItem; page?: PageRefresh }
  | Failure;

/** «Перезапустить распознавание». */
export type RetryOcrResult =
  | { ok: true; enqueuedJobs: number; totalPdfs: number }
  | (Failure & { emailUnconfirmed?: boolean });

/** «Обновить страницу карточки» — after a re-recognition, or a deferred drop. */
export type RefreshPageResult =
  | { ok: true; page: PageRefresh }
  | Failure;
