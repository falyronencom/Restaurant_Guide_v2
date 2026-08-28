/**
 * Quality Health Service — AI-ops Brick-1 orchestration.
 *
 * Composes the read-only quality-immunity signals from qualityHealthModel into a
 * single health payload for the admin supervisor panel. No business logic beyond
 * assembly — the invariants live in the model.
 */

import * as qualityHealthModel from '../models/qualityHealthModel.js';

/**
 * Cache lifetime.
 *
 * Longer than the badges cache (30 s) because this payload is far heavier: three of the
 * signals pull EVERY active establishment and walk the rows in JS — that is the price of
 * reusing the live projection helpers, which is also what guarantees the counts can never
 * diverge from the sitemap. Since the admin shell mounts this from two places now (the
 * health screen and the dashboard's attention panel), an uncached read would repeat those
 * scans on every visit to the landing screen.
 *
 * Staleness is disclosed, not hidden: the payload carries generated_at and the screen
 * header prints it as "снимок HH:MM". A cached snapshot is literally what that header
 * promises — this is the one endpoint where caching makes the UI more truthful, not less.
 */
export const CACHE_TTL_MS = 120_000;

let cache = null;

/// Монотонный номер обращения. Порядок записей решается ИМ, а не часами.
///
/// Сначала здесь стояло сравнение по `Date.now()`, и это давало две дыры сразу.
/// Первая: две сборки, стартовавшие в одну миллисекунду, — в прогретом процессе
/// это 170 случаев из 200, — становились неразличимы, и нестрогое сравнение
/// разрешало ничью в пользу ответившего последним, то есть ровно наоборот.
/// Вторая: перевод системных часов назад ломал порядок целиком. Счётчик не
/// зависит от стенных часов и не даёт ничьих по построению.
let writeSeq = 0;

/// Номер, до которого включительно записи запрещены.
///
/// Без этого сброс кэша обходился летящей сборкой: `invalidateCache()` ставит
/// `cache = null`, а условие записи начиналось с `!cache` — то есть сборка,
/// стартовавшая ДО сброса, беспрепятственно возвращала дореформенный снимок и
/// получала на него полную аренду. Модератор снимал флаг, рейл показывал новое
/// число, а карточка «Флаги без реакции» — старое, до двух минут, и вычистить
/// его было нечем: модерация заведений этот кэш не трогает.
let invalidatedUpTo = 0;

/**
 * Drops the cache. Wired into the three menu-item writes, the partner's own menu-item
 * edit, and establishment REJECTION — but not into the rest of establishment moderation.
 *
 * badgesService.invalidateCache() is called from six moderation writes, and copying that
 * wholesale would be wrong: approving or suspending an establishment has no bearing on
 * whether the OTHER cards in the catalogue reach the sitemap, and hanging a full
 * recomputation on those actions is exactly the cost that made a rail badge for this
 * signal a bad trade in the first place.
 *
 * Rejection is the exception, and only since stage 7: hanging_flags is now scoped to
 * CATALOGUE_TRACK_STATUSES, and rejecting moves an establishment OUT of that scope, so
 * all of its flagged items leave the count at once. Approve (pending → active), suspend
 * and unsuspend all stay inside the scope and genuinely change nothing here.
 *
 * But hide / unhide / dismiss-flag on a menu item change `hanging_flags` directly — the
 * same number this snapshot reports — and they already drop the badges cache on the very
 * next line. Leaving this one stale there put two numbers for one quantity in a single
 * window: the rail (fresh, from badges) saying 11 while the health card said 12, and on
 * the dashboard those two land in adjacent rows of the same panel.
 *
 * The refresh button (`?refresh=1`) stays the way a human forces a read regardless.
 */
export const invalidateCache = () => {
  cache = null;
  // Всё, что уже летит, писать не вправе: его данные прочитаны ДО этого сброса.
  invalidatedUpTo = writeSeq;
};

/**
 * Assemble the full Tier-0 quality-health snapshot (scope: active establishments).
 *
 * @param {{ force?: boolean }} [options] force bypasses the cache — the refresh button.
 * @returns {Promise<Object>}
 */
export const getQualityHealth = async ({ force = false } = {}) => {
  const seq = ++writeSeq;

  // Отрицательный возраст — не «очень свежо», а переведённые назад часы. Без
  // этой половины условия шаг часов назад замораживал снимок для всех читателей
  // до тех пор, пока часы не догонят.
  const age = cache === null ? null : Date.now() - cache.takenAt;
  if (!force && age !== null && age >= 0 && age < CACHE_TTL_MS) {
    return cache.value;
  }

  const value = await assembleSnapshot();

  // The write is CONDITIONAL, and the condition is load-bearing.
  //
  // An assembly runs eight queries, three of which pull every active establishment and
  // walk the rows in JS, so a request that STARTED earlier can FINISH later. An
  // unconditional write means "last responder wins": a read that began before a
  // moderator acted would overwrite the fresh snapshot the refresh button just produced,
  // and nothing would clear it — establishment moderation deliberately does not drop
  // this cache. The client-side provider already carries exactly this guard (a
  // generation counter: the request sent last wins, not the one answered last); the
  // server was missing it.
  //
  // Ordering is by START time, not by the snapshot's own timestamp. That distinction is
  // the whole point and it is counter-intuitive: generated_at is stamped when assembly
  // FINISHES, so the snapshot built from older reads carries the *later* stamp. Sorting
  // by it would invert the very order this guard exists to preserve. What a snapshot saw
  // is fixed by when it started reading.
  //
  // Expiry, separately, runs off takenAt — the moment the data was actually assembled —
  // so a snapshot that took three seconds to build still lives its full CACHE_TTL_MS
  // rather than paying for its own assembly time.
  // takenAt берётся у Date.now(), а не разбором generated_at. Разница не
  // косметическая: срок жизни сверяется с Date.now(), и метка из payload сделала бы
  // сравнение двухчасовым — два источника времени, которые обязаны совпадать, но
  // ничем не связаны. Для показа человеку generated_at остаётся как есть.
  //
  // Два условия, и оба несущие. `seq > invalidatedUpTo` отсекает сборки, начатые до
  // сброса кэша. `cache.seq < seq` (строго, ничьих не бывает) отсекает раннюю сборку,
  // финишировавшую после поздней.
  if (seq > invalidatedUpTo && (cache === null || cache.seq < seq)) {
    cache = { seq, takenAt: Date.now(), value };
  }
  return value;
};

/**
 * The uncached assembly. Split out so the cache above reads as one decision.
 *
 * `scope: 'active'` describes the establishment-level signals — those genuinely restrict
 * to active rows. THREE signals are deliberately wider and the consuming screen names
 * each one's population on its own card rather than letting the header speak for all:
 *
 *   - menu_completeness.ocr_failed_count / .ocr_stuck_count — every OCR job, whatever the
 *     establishment's status. Narrowing these to active would hide the most time-critical
 *     case there is: a partner submitted a card, its menu failed to parse, and the card is
 *     now waiting in the moderation queue with no menu. That establishment is 'pending'.
 *   - hanging_flags — CATALOGUE_TRACK_STATUSES (active + pending + suspended).
 *
 * @returns {Promise<Object>}
 */
const assembleSnapshot = async () => {
  const [
    unreachable,
    offCanon,
    menuCompleteness,
    geo,
    hours,
    attributeCensus,
    flags,
    priceDistribution,
  ] = await Promise.all([
    qualityHealthModel.getUnreachableEstablishments(),
    qualityHealthModel.getOffCanonCounts(),
    qualityHealthModel.getMenuCompleteness(),
    qualityHealthModel.getOutOfBoundsEstablishments(),
    qualityHealthModel.getInvalidHours(),
    qualityHealthModel.getAttributeKeyCensus(),
    qualityHealthModel.getHangingFlags(),
    qualityHealthModel.getPriceDistributionAnomalies(),
  ]);

  return {
    scope: 'active',
    generated_at: new Date().toISOString(),
    canon_reachability: {
      unreachable_count: unreachable.count,
      unreachable_samples: unreachable.samples,
      category_offcanon_count: offCanon.category_offcanon_count,
      cuisine_offcanon_count: offCanon.cuisine_offcanon_count,
    },
    menu_completeness: menuCompleteness,
    geo_bounds: geo,
    working_hours: hours,
    attribute_census: attributeCensus,
    hanging_flags: flags,
    price_distribution: priceDistribution,
  };
};
