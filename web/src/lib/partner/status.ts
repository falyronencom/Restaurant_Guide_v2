/**
 * Establishment status display metadata (Phase C Slice 1, Segment B).
 *
 * Russian labels + cabinet tab ordering, plus the self-vs-admin suspension
 * distinction (a self-suspension carries no suspend_reason; an admin suspension
 * does — backend updateEstablishment / feedback_admin_vs_self_suspend).
 */

import type { EstablishmentStatus, ModerationNotes } from '@/lib/api/types';

export const STATUS_LABELS: Record<EstablishmentStatus, string> = {
  draft: 'Черновик',
  pending: 'На модерации',
  active: 'Опубликовано',
  rejected: 'Отклонено',
  suspended: 'Приостановлено',
};

/** Cabinet tab order — most actionable first. */
export const STATUS_ORDER: readonly EstablishmentStatus[] = [
  'active',
  'pending',
  'draft',
  'rejected',
  'suspended',
];

/**
 * True for an ADMIN suspension (carries a suspend_reason). A self-suspension has
 * no suspend_reason and is read-only in the wizard (resume is out of slice).
 */
export function isAdminSuspended(notes: ModerationNotes): boolean {
  return !!notes && typeof notes.suspend_reason === 'string';
}
