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

/**
 * A new account — on the same e-mail only. The app and the site sign up and
 * sign in by e-mail (by phone — once SMS comes, Coordinator 19.10.2026): «на
 * ту же почту или телефон» promised what neither can do (critic 2Г, П3-04).
 */
export const NEW_ACCOUNT_NOTE = 'Новую учётную запись можно завести на ту же почту.';

/**
 * What may stay outside the app — the Coordinator's text, word for word
 * (09.11.2026, «Текст да, 3 месяца»; critic 2Г, item 4 of the findings): a
 * bold lead-in, then the text, as approved. The app shows the same words
 * (mobile delete_account_screen.dart).
 */
export const OUTSIDE_COPIES_LEAD = 'Что может остаться вне приложения.';
export const OUTSIDE_COPIES_TEXT =
  'Учётная запись удаляется из приложения и с сайта сразу. Какое-то время следы ещё хранятся в служебных местах: '
  + 'в журналах сервера — до 7 дней, в отправленных вам письмах у почтовой службы — до 30 дней, в зашифрованных '
  + 'копиях базы — до 3 месяцев. Эти копии не публикуются: они нужны, чтобы восстановить сервис при сбое и '
  + 'проверять обновления.';
