/*
 * Account deletion — what the site says and checks (brief В1, 18.10.2026:
 * App Store 5.1.1(v), Google Play, law 99-З). Client-safe module: constants
 * and texts only, shared by the profile island, the public page
 * /udalenie-uchetki and the Route Handler.
 *
 * The backend deletes by anonymisation (backend/src/services/
 * accountDeletionService.js); the lists below say the same in a person's
 * words. The Coordinator's decisions behind them: reviews stay with the
 * author «Гость»; an establishment keeps a booking's date, time and guests
 * without the name and phone; a holder of cards writes to support first; the
 * confirmation is the word УДАЛИТЬ.
 */

/** The word that confirms the deletion — the backend checks it too. */
export const ACCOUNT_DELETION_WORD = 'УДАЛИТЬ';

/** Where a person without the app, or a holder of cards, writes. */
export const SUPPORT_EMAIL = 'support@nirivio.by';

/** Whether the typed text is the word: case and surrounding spaces aside. */
export function isDeletionWord(typed: string): boolean {
  return typed.trim().toUpperCase() === ACCOUNT_DELETION_WORD;
}

/** What goes with every account. */
export const DELETED_ITEMS: readonly string[] = [
  'Имя, почта, телефон и фото профиля',
  'Избранное, уведомления и их настройки',
  'Вход: в эту учётную запись больше не войти ни паролем, ни через Google или Яндекс',
];

/**
 * What goes with a partner's account besides — the profile names it to a
 * partner only, as the app does: only a partner has cards.
 */
export const DRAFTS_ITEM = 'Черновики карточек заведений, которые не публиковались';

/** What stays, without the person's name. */
export const KEPT_ITEMS: readonly string[] = [
  'Ваши отзывы и оценки — автором будет «Гость», без фото',
  'Брони — у заведения останутся дата, время и число гостей. Предстоящие брони отменятся, заведение получит уведомление',
];
