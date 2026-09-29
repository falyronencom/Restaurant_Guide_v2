/**
 * Пакетное снятие флагов проверки с позиций меню — логика. Запуск и печать —
 * index.js.
 *
 * Зачем (29.09.2026, чип из сессии «PDF картинкой в первую очередь»). Когда
 * уже распознанный файл меню распознаётся повторно, sanityChecker сравнивает
 * новые цены с прежними и при расхождении больше чем втрое ставит флаг
 * price_delta_anomaly. Перезапуск 28.09 после смены модели OCR дал 32 таких
 * флага у двух заведений, все одного вида: прежней «ценой» были граммы,
 * прочитанные июльской моделью. Панель снимает флаг по одной позиции; волну
 * такого размера снимает этот скрипт. Запускает его сессия по слову
 * Координатора (решение 29.09.2026: скрипт вместо кнопки в панели).
 *
 * Запись делает то же, что «Снять флаг» в панели
 * (adminService.dismissMenuItemFlag), только пачкой и одной транзакцией:
 * - у каждой позиции пачки sanity_flag = NULL и updated_at = NOW();
 * - на каждую позицию — запись журнала 'dismiss_sanity_flag': прежний флаг в
 *   old_data, автор — названный администратор, user_agent — AUDIT_USER_AGENT.
 *   Журнал пишется тем же запросом, что и снятие, поэтому снятого флага без
 *   записи в журнале не бывает;
 * - скрытие позиций не меняется.
 *
 * Пачка — явно названные заведения плюс одна причина (решение Координатора
 * 29.09.2026). «Всё, что показывает фильтр экрана» не годится: поиск экрана
 * ищет подстроку и в названии заведения, и в названии блюда.
 *
 * Защиты — каждая отказывает до записи или откатывает её:
 * - причина — только из канона SANITY_FLAG_REASONS;
 * - заведение — по id или точному названию. Одно название у нескольких
 *   заведений — отказ со списком id. Заведение вне очереди модерации (статус
 *   не из CATALOGUE_TRACK_STATUSES) — отказ: его флагов модератор не видит;
 * - число и состав: запись требует N, подтверждённое человеком, и отпечаток
 *   пачки из того же сухого прогона. Снятие идёт по условию «заведения +
 *   причина»; если снялось не ровно N или не те позиции, что в сухом прогоне
 *   (очередь успела измениться, в команде другое заведение с тем же N), —
 *   транзакция откатывается;
 * - автор записи — действующий аккаунт с ролью из PANEL_ACTION_ROLES, как у
 *   writeAccess в adminRoutes.js: просмотрщик и партнёр получают отказ.
 *
 * Чего скрипт не делает:
 * - не сбрасывает кэш счётчиков работающего сервера: кэш живёт внутри его
 *   процесса (badgesService — 30 с, qualityHealthService — 2 мин). Очередь
 *   «Позиции меню» покажет изменения сразу после обновления страницы.
 *   Счётчик в меню панели грузится при открытии панели и покажет новое число
 *   после обновления страницы не раньше чем через 30 с. «Здоровье данных» —
 *   через 2 мин или сразу по кнопке обновления;
 * - как и панель, сдвигает updated_at. reocr-menus.js такое снятие правкой не
 *   считает: узнаёт его по записи журнала — метки у снятия и записи здесь
 *   равны (правило — scripts/reocr-menus/plan.js).
 */

import { createHash } from 'crypto';
import { SANITY_FLAG_REASONS } from '../../src/services/ocr/sanityChecker.js';
import { CATALOGUE_TRACK_STATUSES } from '../../src/constants/establishmentVocab.js';
import { PANEL_ACTION_ROLES } from '../../src/config/panelRoles.js';

/** Подпись скрипта в журнале действий (поле user_agent) — админ видит её в записи. */
export const AUDIT_USER_AGENT = 'scripts/dismiss-menu-flags';

/**
 * Подписи причин — зеркало kSanityFlagReasons из
 * admin-web/lib/config/moderation_vocabulary.dart: Координатор читает одни и
 * те же слова в чате и в панели. Расхождение ловит тест скрипта.
 */
export const REASON_LABELS = Object.freeze({
  price_below_threshold: 'Цена ниже порога',
  price_above_threshold: 'Цена выше порога',
  low_confidence: 'Низкая уверенность распознавания',
  price_delta_anomaly: 'Резкое изменение цены',
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT_RE = /^[0-9a-f]{10}$/;

/** Отказ: условие не выполнено, в базе ничего не изменено. */
export class Refusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'Refusal';
  }
}

/**
 * Отпечаток состава пачки: сухой прогон печатает его, запись сверяет с тем,
 * что сняла. Порядок id не важен — сортировка внутри.
 */
export const fingerprint = (ids) => createHash('sha256')
  .update([...ids].sort().join(','))
  .digest('hex')
  .slice(0, 10);

const assertReason = (reason) => {
  if (!SANITY_FLAG_REASONS.includes(reason)) {
    throw new Refusal(
      `Неизвестная причина «${reason ?? ''}». Допустимые: ${SANITY_FLAG_REASONS.join(', ')}.`,
    );
  }
};

/**
 * Заведения пачки — по id или точному названию.
 *
 * Повторы схлопываются по id: название и id одного заведения — одно
 * заведение. Ненайденное, неоднозначное или вне очереди заведение — отказ всей
 * пачки, а не пропуск: пачка — ровно то, что названо.
 */
const resolveVenues = async (client, selectors) => {
  const wanted = (selectors ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (wanted.length === 0) {
    throw new Refusal('Не названо ни одного заведения: --establishment=<id или точное название>.');
  }

  const venues = new Map();
  for (const selector of wanted) {
    const byId = UUID_RE.test(selector);
    const { rows } = await client.query(
      `SELECT id, name, city, status
         FROM establishments
        WHERE ${byId ? 'id = $1' : 'name = $1'}
        ORDER BY city, id`,
      [selector],
    );

    if (rows.length === 0) {
      throw new Refusal(
        `Заведение «${selector}» не найдено${byId ? '' : ' (название — точное, с регистром)'}.`,
      );
    }
    if (rows.length > 1) {
      const list = rows.map((v) => `  ${v.id}  ${v.name} · ${v.city} · ${v.status}`).join('\n');
      throw new Refusal(`Название «${selector}» у ${rows.length} заведений — укажите id:\n${list}`);
    }

    const [venue] = rows;
    if (!CATALOGUE_TRACK_STATUSES.includes(venue.status)) {
      throw new Refusal(
        `«${venue.name}» (${venue.id}) — статус ${venue.status}, вне очереди модерации `
        + `(${CATALOGUE_TRACK_STATUSES.join(', ')}): её флагов модератор не видит.`,
      );
    }
    venues.set(venue.id, venue);
  }
  return [...venues.values()];
};

/**
 * Автор записи журнала. Те же правила, что у writeAccess панели: только роли
 * из PANEL_ACTION_ROLES и только действующий аккаунт.
 */
const resolveAuthor = async (client, email) => {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized.includes('@')) {
    throw new Refusal(
      'Запись требует --admin-email=<почта администратора>: от его имени пишется журнал.',
    );
  }

  const { rows } = await client.query(
    'SELECT id, email, name, role, is_active FROM users WHERE email = $1',
    [normalized],
  );
  const [account] = rows;
  if (!account) {
    throw new Refusal(`Аккаунта с почтой ${normalized} нет.`);
  }
  if (!PANEL_ACTION_ROLES.includes(account.role)) {
    throw new Refusal(
      `У ${normalized} роль ${account.role}: снимать флаги может только ${PANEL_ACTION_ROLES.join(', ')}.`,
    );
  }
  if (account.is_active !== true) {
    throw new Refusal(`Аккаунт ${normalized} отключён.`);
  }
  return account;
};

/**
 * Заведения очереди, у которых есть флаги этой причины, — отсюда сессия берёт
 * id для сухого прогона. Только чтение.
 *
 * @returns {Promise<{id, name, city, status, items: number, hidden: number}[]>}
 */
export const listFlaggedVenues = async (client, reason) => {
  assertReason(reason);
  const { rows } = await client.query(
    `SELECT e.id, e.name, e.city, e.status,
            COUNT(*)::int AS items,
            (COUNT(*) FILTER (WHERE mi.is_hidden_by_admin))::int AS hidden
       FROM menu_items mi
       JOIN establishments e ON e.id = mi.establishment_id
      WHERE mi.sanity_flag->>'reason' = $1
        AND e.status = ANY($2::varchar[])
      GROUP BY e.id
      ORDER BY items DESC, e.name, e.id`,
    [reason, CATALOGUE_TRACK_STATUSES],
  );
  return rows;
};

/**
 * Сухой прогон: что снимет запись. Только чтение.
 *
 * @returns {Promise<{reason: string, venues: Object[], total: number, fingerprint: string}>}
 *          venues — в порядке, в каком названы, у каждого items
 */
export const planDismissal = async (client, { establishments, reason }) => {
  assertReason(reason);
  const venues = await resolveVenues(client, establishments);

  const { rows } = await client.query(
    // media_id первым: position считается внутри файла, и без группировки по
    // файлу позиции двух страниц меню шли бы вперемешку.
    `SELECT id, establishment_id, item_name, price_byn, sanity_flag, is_hidden_by_admin
       FROM menu_items
      WHERE establishment_id = ANY($1::uuid[])
        AND sanity_flag->>'reason' = $2
      ORDER BY media_id, position, id`,
    [venues.map((v) => v.id), reason],
  );

  return {
    reason,
    venues: venues.map((v) => ({
      ...v,
      items: rows.filter((item) => item.establishment_id === v.id),
    })),
    total: rows.length,
    fingerprint: fingerprint(rows.map((item) => item.id)),
  };
};

/**
 * Снятие и журнал — один запрос: previous — флаги позиций названных заведений
 * до снятия, cleared снимает флаги причины и возвращает прежние, журнал
 * получает по строке на каждую снятую позицию.
 *
 * Причина проверяется в UPDATE, а не в previous. previous — снимок на начало
 * запроса; если строку за это время изменил другой (модератор снял флаг в
 * панели, партнёр поправил позицию), UPDATE дождётся его и перепроверит своё
 * условие на новой версии строки — но только условие самого UPDATE. Стой
 * причина в снимке, уже снятый флаг снялся бы второй раз, с лишней записью
 * журнала от нашего автора, и число сошлось бы.
 */
const DISMISS_SQL = `
  WITH previous AS (
    SELECT id, sanity_flag
      FROM menu_items
     WHERE establishment_id = ANY($1::uuid[])
  ), cleared AS (
    UPDATE menu_items mi
       SET sanity_flag = NULL, updated_at = NOW()
      FROM previous p
     WHERE mi.id = p.id
       AND mi.sanity_flag->>'reason' = $2
    RETURNING mi.id, p.sanity_flag AS previous_flag
  )
  INSERT INTO audit_log (
    user_id, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent
  )
  SELECT $3, 'dismiss_sanity_flag', 'menu_item', c.id,
         jsonb_build_object('sanity_flag', c.previous_flag),
         jsonb_build_object('sanity_flag', NULL),
         NULL, $4
    FROM cleared c
  RETURNING entity_id`;

/**
 * Запись: снимает флаги причины у названных заведений, если снимается ровно
 * то, что показал сухой прогон: expect позиций с отпечатком plan. Одна
 * транзакция; при отказе или сбое — откат, соединение из транзакции выходит.
 *
 * @returns {Promise<{reason: string, venues: Object[], dismissed: string[], author: Object}>}
 */
export const applyDismissal = async (client, {
  establishments,
  reason,
  expect,
  plan,
  adminEmail,
}) => {
  assertReason(reason);
  if (!Number.isInteger(expect) || expect < 1) {
    throw new Refusal(
      'Запись требует --expect=<N>: число позиций из сухого прогона, подтверждённое человеком.',
    );
  }
  if (typeof plan !== 'string' || !FINGERPRINT_RE.test(plan)) {
    throw new Refusal('Запись требует --plan=<отпечаток> из того же сухого прогона.');
  }

  await client.query('BEGIN');
  try {
    const author = await resolveAuthor(client, adminEmail);
    const venues = await resolveVenues(client, establishments);

    const { rows } = await client.query(DISMISS_SQL, [
      venues.map((v) => v.id),
      reason,
      author.id,
      AUDIT_USER_AGENT,
    ]);
    const dismissed = rows.map((r) => r.entity_id);

    if (dismissed.length !== expect) {
      throw new Refusal(
        `Под условие попало ${dismissed.length}, подтверждено ${expect} — ничего не изменено. `
        + 'Очередь изменилась после сухого прогона: повторите его.',
      );
    }
    if (fingerprint(dismissed) !== plan) {
      throw new Refusal(
        `Число сошлось (${expect}), но состав — не тот, что в сухом прогоне `
        + `(отпечаток ${fingerprint(dismissed)}, ожидался ${plan}) — ничего не изменено. `
        + 'Проверьте заведения в команде и повторите сухой прогон.',
      );
    }

    await client.query('COMMIT');
    return {
      reason,
      venues,
      dismissed,
      author,
    };
  } catch (err) {
    // Ошибка отката не должна подменить собой причину: если соединение
    // оборвано, сервер откатит транзакцию сам.
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
};

// ============================================================================
// Печать
// ============================================================================

/** plural(1,'флаг','флага','флагов') → «флаг»; 2 → «флага»; 5, 11, 12 → «флагов»; 21 → «флаг». */
export const plural = (n, one, few, many) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

const finite = (value) => {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? n : null;
};

const ruNumber = (value, minDigits, maxDigits) => new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: minDigits,
  maximumFractionDigits: maxDigits,
}).format(value);

// Числа — по правилам форматтеров панели (admin-web/lib/config/formatters.dart
// и moderation_vocabulary.dart): одна и та же цена не должна выглядеть в чате
// иначе, чем на экране модератора.

/** Деньги как formatMoney: 1000 → «1 000», 1234.5 → «1 234,50». */
const money = (value) => (Number.isInteger(value) ? ruNumber(value, 0, 0) : ruNumber(value, 2, 2));

/** Доля как _percent: 0.5 → «50%». */
const percent = (value) => `${Math.round(value * 100)}%`;

/** Кратность как _ratio + _times: «в 5 раз», «в 4 раза», «в 10,9 раза». */
const times = (ratio) => (Number.isInteger(ratio)
  ? `в ${ruNumber(ratio, 0, 0)} ${plural(ratio, 'раз', 'раза', 'раз')}`
  : `в ${ruNumber(ratio, 1, 1)} раза`);

/**
 * Что не так с позицией — фраза describeSanityFlag из панели, со строчной
 * буквы. Незнакомое правило или неполные подробности — исходная запись флага:
 * непонятное лучше невидимого.
 */
export const describeFlag = (flag) => {
  const d = flag?.details ?? {};
  switch (flag?.reason) {
    case 'price_below_threshold':
    case 'price_above_threshold': {
      const price = finite(d.price);
      const threshold = finite(d.threshold);
      if (price !== null && threshold !== null) {
        return `цена ${money(price)} BYN при пороге ${money(threshold)} BYN`;
      }
      break;
    }
    case 'low_confidence': {
      const confidence = finite(d.confidence);
      const threshold = finite(d.threshold);
      if (confidence !== null && threshold !== null) {
        return `уверенность распознавания ${percent(confidence)} при пороге ${percent(threshold)}`;
      }
      break;
    }
    case 'price_delta_anomaly': {
      const previous = finite(d.previousPrice);
      const current = finite(d.currentPrice);
      const ratio = finite(d.ratio);
      if (previous !== null && current !== null) {
        const change = `цена ${current > previous ? 'выросла' : 'упала'} `
          + `с ${money(previous)} до ${money(current)} BYN`;
        return ratio === null ? change : `${change} — ${times(ratio)}`;
      }
      break;
    }
    default:
      break;
  }
  return JSON.stringify(flag ?? null);
};

const venueTitle = (venue) => `${venue.name} (${venue.city})`;

const joinRu = (parts) => (parts.length <= 1
  ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}`);

/** Таблица сухого прогона: по заведениям, строка на позицию. */
export const formatPlan = (plan) => {
  const lines = [`Причина: ${plan.reason} — «${REASON_LABELS[plan.reason]}»`];

  for (const venue of plan.venues) {
    const hidden = venue.items.filter((item) => item.is_hidden_by_admin).length;
    const count = `${venue.items.length} ${plural(venue.items.length, 'позиция', 'позиции', 'позиций')}`;
    lines.push('');
    lines.push(
      `${venue.name} · ${venue.city} · ${venue.status} · ${venue.id} — ${count}`
      + `${hidden > 0 ? `, из них скрыто ${hidden}` : ''}`,
    );
    for (const item of venue.items) {
      lines.push(
        `  ${item.item_name} — ${describeFlag(item.sanity_flag)}`
        + `${item.is_hidden_by_admin ? '  [скрыта]' : ''}`,
      );
    }
  }

  lines.push('');
  lines.push(
    `Итого: ${plan.total} ${plural(plan.total, 'позиция', 'позиции', 'позиций')} у `
    + `${plan.venues.length} ${plural(plan.venues.length, 'заведения', 'заведений', 'заведений')}; `
    + `отпечаток ${plan.fingerprint}.`,
  );
  return lines.join('\n');
};

/**
 * Вопрос Координатору перед записью — текст утверждён им 29.09.2026. Ответ
 * «да, N» и есть подтверждение: N уходит в --expect.
 */
export const confirmationText = (plan) => {
  const n = plan.total;
  const where = joinRu(plan.venues.map(venueTitle));
  const label = REASON_LABELS[plan.reason];

  if (n === 1) {
    return `Снять 1 флаг «${label}» у ${where}? Позиция уйдёт из очереди. `
      + 'Если она скрыта, то останется скрытой. Снятие попадёт в журнал действий.';
  }
  return `Снять ${n} ${plural(n, 'флаг', 'флага', 'флагов')} «${label}» у ${where}? `
    + 'Позиции уйдут из очереди. Скрытые позиции останутся скрытыми. '
    + 'Каждая попадёт в журнал действий.';
};

/** Список заведений очереди с флагами причины. */
export const formatVenueList = (reason, venues) => {
  const total = venues.reduce((sum, v) => sum + v.items, 0);
  const lines = [
    `Флаги «${REASON_LABELS[reason]}» (${reason}) в очереди: `
    + `${total} ${plural(total, 'позиция', 'позиции', 'позиций')} у `
    + `${venues.length} ${plural(venues.length, 'заведения', 'заведений', 'заведений')}.`,
  ];
  for (const v of venues) {
    lines.push(
      `  ${v.id}  ${v.name} · ${v.city} · ${v.status} — ${v.items}`
      + `${v.hidden > 0 ? ` (скрыто ${v.hidden})` : ''}`,
    );
  }
  return lines.join('\n');
};
