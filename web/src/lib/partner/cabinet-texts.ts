/**
 * What the partner reads in the cabinet's card sections — the «Меню» section,
 * the card's header, the restart and pause windows. One module, so that a
 * change of wording is one edit.
 *
 * Status of the wording (directive of part 1 of the thread «Кабинет партнёра
 * на сайте», 23.11.2026, section 2):
 *   - T1–T12 and the new refusal texts are approved by the Coordinator
 *     (23.11.2026, 18:27:22Z, in the window of the thread's Trunk
 *     local_91714511, turn 258d3ec6), T7's line under a mark in the words
 *     «могут видеть»;
 *   - the recognition states are the app's texts, already approved by the
 *     Coordinator (mobile partner_menu_screen.dart), with the site's section
 *     name «Фотографии и меню» for the app's «Медиа» and without «внизу
 *     экрана» (decision В8 of the directive).
 */

import { SUPPORT_EMAIL } from '@/lib/account/deletion';

// ---------------------------------------------------------------------------
// The card's sections and header
// ---------------------------------------------------------------------------

export const CARD_TEXTS = {
  backToCabinet: 'Кабинет',
  viewOnSite: 'Посмотреть на сайте',
  sessionExpired: 'Сессия истекла.',
  signInAgain: 'Войти снова',
  loadFailed: 'Не удалось загрузить заведение.',
  toCabinet: 'В кабинет',
} as const;

// ---------------------------------------------------------------------------
// T6 — «Приостановить показ»
// ---------------------------------------------------------------------------

export const PAUSE_TEXTS = {
  button: 'Приостановить показ',
  busy: 'Приостановка…',
  title: 'Приостановить показ?',
  body:
    'Гости перестанут видеть карточку на сайте и в приложении. Возобновить показ можно в любой момент. Пока показ приостановлен, изменить данные карточки нельзя.',
  cancel: 'Отмена',
  confirm: 'Приостановить',
} as const;

// ---------------------------------------------------------------------------
// T12 — the card's form, in place of the old restart button
// ---------------------------------------------------------------------------

export const FORM_MENU_LINK = {
  before: 'Распознанные блюда и перезапуск распознавания — в разделе ',
  link: '«Меню»',
  after: '.',
} as const;

// ---------------------------------------------------------------------------
// The «Меню» section
// ---------------------------------------------------------------------------

/** The site's name of the form's section with the menu files (MediaSection). */
const FILES_SECTION = '«Фотографии и меню»';

export const MENU_TEXTS = {
  title: 'Меню',
  // T11
  sectionField: 'Раздел меню',
  noSection: 'Без раздела',
  nameField: 'Название',
  priceField: 'Цена (BYN)',
  pricePlaceholder: 'например 6,50',
  noPriceHint: 'Пусто — без цены',
  edit: 'Изменить',
  editTitle: 'Изменить позицию',
  save: 'Сохранить',
  saving: 'Сохранение…',
  cancel: 'Отмена',
  saved: 'Изменения сохранены',
  guestHidden: 'Гостям не показывается: алкоголь и табак',
  attention: 'Требует внимания',
  // T8
  confirmCorrect: 'Всё верно',
  confirmingCorrect: 'Сохранение…',
  // T7б
  itemGone: 'Позиция не найдена — возможно, меню распознано заново. Список обновлён.',
  loadFailed: 'Не удалось загрузить позиции меню',
  retryLoad: 'Повторить',
  stale: 'Не удалось обновить — на экране может быть не последнее состояние.',
  refresh: 'Обновить',
  // Field checks (the server checks none of them and answers 500)
  nameRequired: 'Укажите название',
  nameTooLong: 'Название — не длиннее 255 знаков',
  sectionTooLong: 'Раздел меню — не длиннее 100 знаков',
  priceInvalid: 'Цена — число от 0 до 99 999 999,99, не больше двух знаков после запятой',
  nothingChanged: 'Ничего не изменилось.',
} as const;

/** The recognition states — the app's approved texts, with the site's section name (В8). */
export const RECOGNITION_TEXTS = {
  none: {
    title: 'Меню ещё не загружено',
    hint: `Добавьте фото страниц меню или PDF в разделе ${FILES_SECTION} — позиции появятся здесь сами через несколько минут.`,
  },
  processing: {
    title: 'Распознаём меню…',
    hint: 'Обычно это занимает несколько минут. Позиции появятся здесь сами.',
  },
  notStarted: {
    title: 'Распознавание не запущено',
    hint: 'Файл загружен, но распознавание не началось. Нажмите «Перезапустить распознавание».',
  },
  failed: {
    title: 'Не удалось распознать меню',
    bannerTitle: 'Часть меню не распознана',
    // The file itself cannot be read: a restart reads it the same way.
    hintOtherFile: `Загрузите другой файл в разделе ${FILES_SECTION} — например, фото страниц меню.`,
    hintRestart: `Нажмите «Перезапустить распознавание» или загрузите другой файл в разделе ${FILES_SECTION}.`,
  },
  hidden: {
    title: 'Позиции не показываются',
    hint: `Файл прочитан, но позиции из него сейчас не показываются гостям. Если это ошибка — напишите в поддержку: ${SUPPORT_EMAIL}`,
  },
  nothingFound: {
    title: 'Позиций не нашлось',
    hint: `Файл прочитан, но блюд и цен в нём не нашлось. Загрузите более чёткое фото или другой файл в разделе ${FILES_SECTION}.`,
  },
  // T10
  processingBanner: 'Распознаём меню заново… Обычно это занимает несколько минут. Список обновится сам.',
  // T9
  hiddenNote: `Модератор скрыл часть позиций — гости их не видят. Если это ошибка, напишите в поддержку: ${SUPPORT_EMAIL}.`,
} as const;

// ---------------------------------------------------------------------------
// T1 — the restart and its answers
// ---------------------------------------------------------------------------

export const RESTART_TEXTS = {
  button: 'Перезапустить распознавание',
  busy: 'Запуск…',
  title: 'Перезапустить распознавание?',
  body:
    'Меню будет распознано заново по всем файлам. Названия, цены и разделы, которые вы исправили, вернутся к распознанным. Перезапустить можно 5 раз в сутки.',
  cancel: 'Отмена',
  confirm: 'Перезапустить',
  started: (queued: number, total: number) => `Распознавание запущено (${queued} из ${total})`,
} as const;

/** T4 — no menu files to read (NO_PDF_MENUS). */
export const NO_MENU_FILES = `Сначала добавьте фото меню или PDF в разделе ${FILES_SECTION}.`;

/** T2 — the sixth restart of the day; `wait` — «3 ч 5 мин» (formatWait). */
export function restartsSpent(limit: number, wait: string | null): string {
  const head = `Перезапустить распознавание можно ${limit} ${timesWord(limit)} в сутки.`;
  return wait ? `${head} Следующий раз — через ${wait}.` : head;
}

/** T3 — the day's share of recognition is spent. */
export function recognitionShareSpent(wait: string | null): string {
  return wait
    ? `Лимит распознавания меню на сегодня исчерпан. Продолжить можно через ${wait}.`
    : 'Лимит распознавания меню на сегодня исчерпан. Продолжить можно после полуночи.';
}

/** T5 — under T3 and the states that a confirmed e-mail would help, for an account without one. */
export const CONFIRM_EMAIL = {
  text: 'Подтвердите почту в профиле — у учётных записей с подтверждённой почтой лимит распознавания больше.',
  link: 'Подтвердить почту',
} as const;

/** «раз» after a count: 1 раз, 2–4 раза, 5–20 раз, 21 раз, 22 раза… */
function timesWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'раза';
  return 'раз';
}

// ---------------------------------------------------------------------------
// T7 — why a line needs attention (the panel's words, mobile-site numbers)
// ---------------------------------------------------------------------------

export const FLAG_TEXTS = {
  priceBelow: (price: string, threshold: string) =>
    `Цена ниже порога: ${price} BYN при пороге ${threshold} BYN. Проверьте, верно ли распознано.`,
  priceAbove: (price: string, threshold: string) =>
    `Цена выше порога: ${price} BYN при пороге ${threshold} BYN. Проверьте, верно ли распознано.`,
  lowConfidence: (confidence: string, threshold: string) =>
    `Низкая уверенность распознавания: ${confidence} при пороге ${threshold}. Проверьте название и цену.`,
  priceDelta: (grew: boolean, previous: string, current: string, times: string | null) =>
    `Резкое изменение цены: ${grew ? 'выросла' : 'упала'} с ${previous} до ${current} BYN${times ? ` — ${times}` : ''}. Проверьте, верно ли распознано.`,
  generic: 'Проверьте название и цену.',
  /**
   * Under the reason of a mark (T7, the Coordinator's words of 23.11.2026):
   * «могут видеть», not «видят» — the guest sees one line of a dish's copies,
   * a clean one when there is one (backend menuItemProjections.js
   * guestMenuRows / shownRowOfLine). Not under a line of alcohol or tobacco:
   * the guest does not see that line at all.
   */
  guestSeesCaution: 'Пока метка стоит, гости могут видеть у позиции пометку «уточнить».',
} as const;
