'use server';

import { listEstablishments } from '@/lib/api/endpoints/partner';
import { ApiError, type PartnerEstablishmentListing } from '@/lib/api/types';

/*
 * Partner cabinet Server Actions (Phase C Slice 1, Segment B).
 *
 * State-changing + authed-read operations are Server Actions for the built-in
 * CSRF defense AND because authedFetch may rotate the single-use refresh token
 * (a cookie WRITE), which is illegal during RSC render — only a Server Action or
 * Route Handler may write cookies. So the cabinet hydrates its list here, called
 * from the CabinetDashboard client island on mount (mirrors AuthProvider).
 *
 * create/update/submit actions land in Commit 4 alongside the wizard.
 */

export type LoadEstablishmentsResult =
  | { ok: true; establishments: PartnerEstablishmentListing[] }
  | { ok: false; code: string };

/** Fetch the partner's establishments (all statuses; grouped client-side). */
export async function loadEstablishments(): Promise<LoadEstablishmentsResult> {
  try {
    const data = await listEstablishments();
    return { ok: true, establishments: data.establishments };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, code: err.errorCode ?? `HTTP_${err.statusCode}` };
    }
    return { ok: false, code: 'NETWORK' };
  }
}
