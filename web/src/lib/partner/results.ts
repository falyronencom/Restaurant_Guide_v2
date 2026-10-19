import type {
  EstablishmentStatus,
  PartnerEstablishmentDetail,
  PartnerEstablishmentListing,
  SessionUser,
} from '@/lib/api/types';
import type { Refusal } from '@/lib/partner/errors';

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

export type WriteResult =
  | { ok: true; status?: EstablishmentStatus; base_score?: number | null }
  | Failure;

export type LoadDetailResult =
  | { ok: true; establishment: PartnerEstablishmentDetail }
  | Failure;
