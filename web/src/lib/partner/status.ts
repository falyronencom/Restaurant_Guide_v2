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

/** The status badge's colours — the cabinet's list and the card's header. */
export const STATUS_BADGE: Record<EstablishmentStatus, string> = {
  draft: 'bg-gray-200 text-figma-text-dark',
  pending: 'bg-brand/15 text-brand-dark',
  active: 'bg-success-status/20 text-success-dark',
  rejected: 'bg-error/15 text-error-dark',
  suspended: 'bg-gray-300 text-figma-text-dark',
};

/**
 * The notes of a card the partner has just paused: the server drops a
 * moderator's leftover suspension marks on the partner's pause (backend
 * establishmentService.suspendEstablishment, utils/moderationNotes.js
 * MODERATOR_SUSPENSION_KEYS), so the pause reads as the partner's own.
 */
export function notesAfterOwnPause(notes: ModerationNotes): ModerationNotes {
  if (!notes) return notes;
  const kept = Object.entries(notes).filter(
    ([key]) => !['suspend_reason', 'suspended_at', 'suspended_from'].includes(key),
  );
  return Object.fromEntries(kept);
}

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
 * no suspend_reason: read-only in the wizard until the partner resumes it
 * (the cabinet's «Возобновить показ»); an admin suspension is edited and sent
 * to moderation again — the partner may not resume it (backend 403
 * ADMIN_SUSPENDED).
 */
export function isAdminSuspended(notes: ModerationNotes): boolean {
  return !!notes && typeof notes.suspend_reason === 'string';
}
