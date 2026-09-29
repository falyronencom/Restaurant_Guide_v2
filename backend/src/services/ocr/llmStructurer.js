/**
 * LLM Structurer
 *
 * Converts raw OCR text (from pdfTextExtractor or visionOcrAdapter) into a
 * structured array of menu items using OpenRouter with strict JSON output.
 *
 * Validates the response with Zod, following the pattern from smartSearchService.js:40-49.
 */

import { z } from 'zod';
import logger from '../../utils/logger.js';
import { getOcrConfig } from '../../config/openrouter.js';

const STRUCTURER_SYSTEM_PROMPT = `You convert raw menu text into structured JSON.

Output ONLY a JSON object with this exact shape, no prose:
{
  "items": [
    {
      "item_name": string,           // exact dish/drink name from menu
      "price_byn": number | null,    // price in Belarusian rubles, null if not stated (e.g. "seasonal")
      "category_raw": string | null, // original section heading (e.g. "Горячие блюда", "Напитки"), null if none
      "confidence": number           // 0.00-1.00, how confident you are this is a real menu position
    }
  ]
}

Rules:
- item_name is required and must be the dish name, not a description
- price_byn must be a number (no currency symbol). If menu shows "15 руб" → 15. If "по сезону" or missing → null.
- category_raw preserves the original section header verbatim
- Skip lines that are not menu items (addresses, phone numbers, hours, promotional text)
- Do not invent items. If the text is gibberish, return {"items": []}

Set menus — one price for several courses or dishes to choose from (a set, a tasting or chef's dinner, a business lunch, "breakfast of 3 dishes"):
- The set's name is the heading of the set's own block (e.g. "Шеф-ужин", "ЗАВТРАК из 3 блюд", "МЯСНОЙ"). When several sets share one heading ("ДЕГУСТАЦИОННЫЕ СЕТЫ"), each set's name is its own heading under it.
- The set is an item with its price; never drop the price.
- Every other priced line inside the set's block (wine pairing, an extra dish, a glass of sparkling) is an item with its own price.
- item_name of a priced line is the name of what is sold ("Сет без сопровождения вина", "Винное сопровождение", "дополнительное блюдо"). A line that only states a price ("стоимость сета без вина 150", "предлагаем сет из 2 бокалов вина 60") is not a name: use the name of what it prices — the set's name for the set itself, the heading above it for an addition such as "ВИННОЕ СОПРОВОЖДЕНИЕ".
- Every dish, drink or option listed inside the set is its own item with price_byn null.
- All items of a set — its price lines and its dishes — have category_raw = the set's name. Course headings inside a set ("ЗАКУСКИ", "ОСНОВНОЕ БЛЮДО", "ДЕСЕРТ", "ВИННАЯ ПАРА", "Яйца", "Супы") are not categories: do not use them as category_raw for the set's items.
- A surcharge next to a dish of a set ("+2 руб") is not its price: price_byn null, and append " (доплата 2 руб)" to item_name with the amount as written.
- Split a set into its dishes only when they are listed one per line (courses, dishes to choose from). A set whose contents are one line joined with "+" ("Сет #1" / "Крем-суп + Блины" / "22") is one item: item_name = "Сет #1 (Крем-суп + Блины)", with its price.
- Inside a set's block every dish or option to choose has price_byn null, even when a note says it counts as an extra dish.
- Not a set: outside a set's block, a heading with one price for each item under it ("БОКАЛ ВИНА 18", "КЛАССИЧЕСКИЙ ЧАЙ 8 BYN" — any of them for that price). Every item under it gets that price; the category is the heading without its price ("БОКАЛ ВИНА").`;

const REQUEST_TIMEOUT_MS = 60000;

// Column widths of menu_items (migration 024): item_name VARCHAR(255),
// category_raw VARCHAR(100).
const ITEM_NAME_MAX = 255;
const CATEGORY_RAW_MAX = 100;

/**
 * Cut a string to the column width instead of rejecting it. A rejected field
 * fails the whole response — every item of the page is lost for one long set
 * name — while a cut name still finds the dish. Counted in code points, as
 * PostgreSQL counts VARCHAR characters.
 */
const cutTo = (max) => (value) => {
  const chars = Array.from(value);
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : value;
};

const ItemSchema = z.object({
  item_name: z.string().min(1).transform(cutTo(ITEM_NAME_MAX)),
  price_byn: z.number().nullable(),
  category_raw: z.string().transform(cutTo(CATEGORY_RAW_MAX)).nullable(),
  confidence: z.number().min(0).max(1),
});

const ResponseSchema = z.object({
  items: z.array(ItemSchema),
});

/**
 * Structure raw menu text into validated items.
 *
 * @param {string} rawText - OCR output
 * @returns {Promise<Object[]>} Array of validated items (may be empty)
 * @throws {Error} on API error, malformed response, or validation failure
 */
export const structureMenu = async (rawText) => {
  if (!rawText || rawText.trim().length === 0) {
    logger.debug('structureMenu called with empty text — returning empty items');
    return [];
  }

  const config = getOcrConfig();
  if (!config.apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured — cannot run LLM structurer');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: STRUCTURER_SYSTEM_PROMPT },
          { role: 'user', content: rawText },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
        // Уровень рассуждений — из getOcrConfig (там же почему minimal).
        ...(config.reasoning && { reasoning: config.reasoning }),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter structurer call failed: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('LLM structurer returned empty content');
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (jsonError) {
      throw new Error(`LLM structurer returned invalid JSON: ${jsonError.message}`);
    }

    const validated = ResponseSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(`LLM structurer response failed schema validation: ${validated.error.message}`);
    }

    logger.debug('LLM structuring complete', {
      rawTextLength: rawText.length,
      itemCount: validated.data.items.length,
      model: config.model,
    });

    return validated.data.items;
  } finally {
    clearTimeout(timeoutId);
  }
};

export { STRUCTURER_SYSTEM_PROMPT, ResponseSchema, ItemSchema, REQUEST_TIMEOUT_MS };
