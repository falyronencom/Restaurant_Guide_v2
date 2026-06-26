import type {
  EstablishmentStatus,
  PartnerEstablishmentDetail,
  PartnerEstablishmentListing,
  SessionUser,
} from '@/lib/api/types';

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

export type LoadEstablishmentsResult =
  | { ok: true; establishments: PartnerEstablishmentListing[] }
  | { ok: false; code: string };

export type CreateResult =
  | {
      ok: true;
      id: string;
      status?: EstablishmentStatus;
      base_score?: number | null;
      /** Re-stamped display user after the first create (role → partner), else unchanged. */
      user: SessionUser | null;
    }
  | { ok: false; code: string };

export type WriteResult =
  | { ok: true; status?: EstablishmentStatus; base_score?: number | null }
  | { ok: false; code: string };

export type LoadDetailResult =
  | { ok: true; establishment: PartnerEstablishmentDetail }
  | { ok: false; code: string };
