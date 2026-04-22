/**
 * Sanity Checker
 *
 * Flags suspicious parsed menu items for moderator review. Runs on the output of
 * llmStructurer BEFORE persistence, so flagged items still land in menu_items
 * with sanity_flag populated — moderators can then decide to keep or hide them.
 *
 * Phase 1 rules (order matters — first failing rule wins):
 *   1. price_below_threshold — price_byn < MIN_PRICE_BYN
 *   2. price_above_threshold — price_byn > MAX_PRICE_BYN
 *   3. low_confidence — confidence < MIN_CONFIDENCE
 *   4. price_delta_anomaly — same item_name existed in previousItems and price
 *      changed by more than MAX_PRICE_DELTA_RATIO
 *
 * Thresholds are module constants for easy tuning. A future Phase 2 may move them
 * to env vars or per-establishment overrides.
 */

const MIN_PRICE_BYN = 0.50;
const MAX_PRICE_BYN = 1000.00;
const MIN_CONFIDENCE = 0.70;
const MAX_PRICE_DELTA_RATIO = 3.00; // 300% — a 10 BYN item becoming 40 BYN triggers

/**
 * Build a Map<normalized_name, price_byn> from previous items for delta lookup.
 * Normalization: lowercase + trim + collapse whitespace.
 *
 * @param {Object[]} previousItems
 * @returns {Map<string, number>}
 */
const buildPreviousPriceMap = (previousItems) => {
  const map = new Map();
  if (!previousItems) return map;

  for (const item of previousItems) {
    if (!item.item_name || item.price_byn == null) continue;
    const key = item.item_name.toLowerCase().trim().replace(/\s+/g, ' ');
    // Numeric fields may come back as strings from pg — normalize to Number.
    map.set(key, Number(item.price_byn));
  }
  return map;
};

/**
 * Check a single item against all rules. Returns the first failing flag or null.
 *
 * @param {Object} item - Parsed menu item
 * @param {Map<string, number>} previousPriceMap
 * @returns {Object|null} sanity_flag object or null
 */
const checkItem = (item, previousPriceMap) => {
  const price = item.price_byn == null ? null : Number(item.price_byn);
  const confidence = item.confidence == null ? null : Number(item.confidence);

  if (price != null && price < MIN_PRICE_BYN) {
    return {
      reason: 'price_below_threshold',
      details: { price, threshold: MIN_PRICE_BYN },
    };
  }

  if (price != null && price > MAX_PRICE_BYN) {
    return {
      reason: 'price_above_threshold',
      details: { price, threshold: MAX_PRICE_BYN },
    };
  }

  if (confidence != null && confidence < MIN_CONFIDENCE) {
    return {
      reason: 'low_confidence',
      details: { confidence, threshold: MIN_CONFIDENCE },
    };
  }

  if (price != null && item.item_name) {
    const key = item.item_name.toLowerCase().trim().replace(/\s+/g, ' ');
    const previousPrice = previousPriceMap.get(key);
    if (previousPrice != null && previousPrice > 0) {
      const ratio = Math.max(price / previousPrice, previousPrice / price);
      if (ratio > MAX_PRICE_DELTA_RATIO) {
        return {
          reason: 'price_delta_anomaly',
          details: {
            previousPrice,
            currentPrice: price,
            ratio: Number(ratio.toFixed(2)),
            threshold: MAX_PRICE_DELTA_RATIO,
          },
        };
      }
    }
  }

  return null;
};

/**
 * Annotate items with sanity_flag. Does not mutate input — returns a new array.
 *
 * @param {Object[]} items - Items from llmStructurer
 * @param {Object[]} previousItems - Items that existed before replacement (for delta comparison)
 * @returns {Object[]} Items with sanity_flag field populated (null for clean items)
 */
export const check = (items, previousItems = []) => {
  const previousPriceMap = buildPreviousPriceMap(previousItems);

  return items.map((item) => ({
    ...item,
    sanity_flag: checkItem(item, previousPriceMap),
  }));
};

export {
  MIN_PRICE_BYN,
  MAX_PRICE_BYN,
  MIN_CONFIDENCE,
  MAX_PRICE_DELTA_RATIO,
  checkItem,
  buildPreviousPriceMap,
};
