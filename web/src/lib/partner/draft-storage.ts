/**
 * The unsent «Создать заведение» form kept in this browser (Decision 5
 * two-stage draft): per account, `{ form, draftId }` — the form as typed and
 * the server draft it saves into, once there is one.
 *
 * The draft id must not outlive its card (сверка находок тестировщика с
 * сайтом, 18.10, пункт С1): a card deleted from the list, or sent to
 * moderation from its edit page, was revived by the next «Создать заведение»
 * — the autosave wrote into the sent card, or got 403 on the deleted one with
 * no way to start anew. forgetWizardDraft drops the kept form when its card
 * is gone or sent; the wizard also checks the card before it restores one.
 */

export const WIZARD_DRAFT_PREFIX = 'nirivio:wizard:new';

export function wizardDraftKey(userId: string): string {
  return `${WIZARD_DRAFT_PREFIX}:${userId}`;
}

/**
 * Drop the account's kept form — only the one that saves into
 * `establishmentId` when one is given (another card's deletion leaves an
 * unrelated unsent form alone).
 */
export function forgetWizardDraft(
  userId: string | null | undefined,
  establishmentId?: string,
): void {
  if (!userId) return;
  const key = wizardDraftKey(userId);
  try {
    if (establishmentId !== undefined) {
      const raw = localStorage.getItem(key);
      const kept = raw ? (JSON.parse(raw) as { draftId?: unknown }) : null;
      if (kept?.draftId !== establishmentId) return;
    }
    localStorage.removeItem(key);
  } catch {
    /* private mode / unreadable — nothing kept to drop */
  }
}
