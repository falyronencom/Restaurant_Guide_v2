import type { SessionUser } from '@/lib/api/types';

/**
 * A signed-in partner (role stamped by the backend; it turns user → partner
 * after the first card is created — lib/partner/operations.ts re-stamps the
 * display cookie). The header then stops offering «Стать партнёром» and the
 * account menu leads to the cabinet as «Мои заведения» (сверка находок
 * тестировщика с сайтом, 18.10, С8).
 */
export function isPartner(user: SessionUser | null | undefined): boolean {
  return user?.role === 'partner';
}

/** The partner cabinet entry — the list of the partner's own cards. */
export const PARTNER_CABINET_HREF = '/cabinet';
