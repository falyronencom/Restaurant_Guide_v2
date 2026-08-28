/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: sanityChecker.js
 *
 * Tests all four Phase 1 rules and boundary conditions. sanityChecker is pure
 * (no I/O), so these tests fully cover the decision logic.
 */

import { readFileSync } from 'fs';
import {
  check,
  checkItem,
  buildPreviousPriceMap,
  SANITY_FLAG_REASONS,
  MIN_PRICE_BYN,
  MAX_PRICE_BYN,
  MIN_CONFIDENCE,
  MAX_PRICE_DELTA_RATIO,
} from '../../services/ocr/sanityChecker.js';

describe('sanityChecker', () => {
  describe('buildPreviousPriceMap', () => {
    test('handles empty / null input', () => {
      expect(buildPreviousPriceMap(null).size).toBe(0);
      expect(buildPreviousPriceMap([]).size).toBe(0);
    });

    test('normalizes names to lowercase, trimmed, single-spaced', () => {
      const map = buildPreviousPriceMap([
        { item_name: '  Борщ   украинский  ', price_byn: 15 },
      ]);
      expect(map.get('борщ украинский')).toBe(15);
    });

    test('skips items with missing price or name', () => {
      const map = buildPreviousPriceMap([
        { item_name: 'A', price_byn: null },
        { item_name: '', price_byn: 10 },
        { item_name: 'B', price_byn: 10 },
      ]);
      expect(map.size).toBe(1);
      expect(map.get('b')).toBe(10);
    });

    test('coerces string prices from pg to numbers', () => {
      const map = buildPreviousPriceMap([
        { item_name: 'A', price_byn: '15.50' },
      ]);
      expect(map.get('a')).toBe(15.5);
    });
  });

  describe('checkItem — price_below_threshold', () => {
    test('flags items below MIN_PRICE_BYN', () => {
      const item = { item_name: 'Napkin', price_byn: 0.10, confidence: 0.9 };
      const flag = checkItem(item, new Map());
      expect(flag).toEqual({
        reason: 'price_below_threshold',
        details: { price: 0.10, threshold: MIN_PRICE_BYN },
      });
    });

    test('does not flag at exactly MIN_PRICE_BYN', () => {
      const item = { item_name: 'A', price_byn: MIN_PRICE_BYN, confidence: 0.9 };
      expect(checkItem(item, new Map())).toBeNull();
    });

    test('does not flag null price', () => {
      const item = { item_name: 'A', price_byn: null, confidence: 0.9 };
      expect(checkItem(item, new Map())).toBeNull();
    });
  });

  describe('checkItem — price_above_threshold', () => {
    test('flags items above MAX_PRICE_BYN', () => {
      const item = { item_name: 'Luxury', price_byn: 1500, confidence: 0.9 };
      const flag = checkItem(item, new Map());
      expect(flag.reason).toBe('price_above_threshold');
      expect(flag.details.price).toBe(1500);
    });

    test('does not flag at exactly MAX_PRICE_BYN', () => {
      const item = { item_name: 'A', price_byn: MAX_PRICE_BYN, confidence: 0.9 };
      expect(checkItem(item, new Map())).toBeNull();
    });
  });

  describe('checkItem — low_confidence', () => {
    test('flags items below MIN_CONFIDENCE', () => {
      const item = { item_name: 'A', price_byn: 15, confidence: 0.5 };
      const flag = checkItem(item, new Map());
      expect(flag.reason).toBe('low_confidence');
      expect(flag.details.confidence).toBe(0.5);
    });

    test('does not flag at exactly MIN_CONFIDENCE', () => {
      const item = { item_name: 'A', price_byn: 15, confidence: MIN_CONFIDENCE };
      expect(checkItem(item, new Map())).toBeNull();
    });

    test('does not flag null confidence', () => {
      const item = { item_name: 'A', price_byn: 15, confidence: null };
      expect(checkItem(item, new Map())).toBeNull();
    });
  });

  describe('checkItem — price_delta_anomaly', () => {
    test('flags when price grew more than ratio threshold', () => {
      const previousMap = new Map([['борщ', 10]]);
      const item = { item_name: 'Борщ', price_byn: 40, confidence: 0.9 };
      const flag = checkItem(item, previousMap);
      expect(flag.reason).toBe('price_delta_anomaly');
      expect(flag.details.previousPrice).toBe(10);
      expect(flag.details.currentPrice).toBe(40);
      expect(flag.details.ratio).toBe(4);
    });

    test('flags when price shrank more than ratio threshold', () => {
      const previousMap = new Map([['pizza', 40]]);
      const item = { item_name: 'pizza', price_byn: 10, confidence: 0.9 };
      const flag = checkItem(item, previousMap);
      expect(flag.reason).toBe('price_delta_anomaly');
    });

    test('does not flag when ratio equals threshold exactly', () => {
      const previousMap = new Map([['a', 10]]);
      const item = { item_name: 'A', price_byn: 10 * MAX_PRICE_DELTA_RATIO, confidence: 0.9 };
      expect(checkItem(item, previousMap)).toBeNull();
    });

    test('does not flag if no previous match', () => {
      const previousMap = new Map([['other', 10]]);
      const item = { item_name: 'New Dish', price_byn: 100, confidence: 0.9 };
      expect(checkItem(item, previousMap)).toBeNull();
    });

    test('matches names case-insensitively with whitespace normalization', () => {
      const previousMap = new Map([['борщ украинский', 10]]);
      const item = { item_name: '  Борщ   Украинский  ', price_byn: 50, confidence: 0.9 };
      const flag = checkItem(item, previousMap);
      expect(flag?.reason).toBe('price_delta_anomaly');
    });
  });

  describe('rule priority (first failing rule wins)', () => {
    test('price_below wins over low_confidence when both would fire', () => {
      const item = { item_name: 'A', price_byn: 0.10, confidence: 0.5 };
      const flag = checkItem(item, new Map());
      expect(flag.reason).toBe('price_below_threshold');
    });

    test('price_above wins over delta_anomaly when both would fire', () => {
      const previousMap = new Map([['a', 10]]);
      const item = { item_name: 'A', price_byn: 2000, confidence: 0.9 };
      const flag = checkItem(item, previousMap);
      expect(flag.reason).toBe('price_above_threshold');
    });
  });

  describe('check (batch)', () => {
    test('does not mutate input', () => {
      const items = [{ item_name: 'A', price_byn: 15, confidence: 0.9 }];
      const result = check(items, []);
      expect(items[0]).not.toHaveProperty('sanity_flag');
      expect(result[0]).toHaveProperty('sanity_flag');
    });

    test('adds sanity_flag = null for clean items', () => {
      const items = [{ item_name: 'A', price_byn: 15, confidence: 0.9 }];
      const result = check(items, []);
      expect(result[0].sanity_flag).toBeNull();
    });

    test('processes multiple items independently', () => {
      const items = [
        { item_name: 'A', price_byn: 0.10, confidence: 0.9 },
        { item_name: 'B', price_byn: 15, confidence: 0.9 },
        { item_name: 'C', price_byn: 15, confidence: 0.5 },
      ];
      const result = check(items, []);
      expect(result[0].sanity_flag?.reason).toBe('price_below_threshold');
      expect(result[1].sanity_flag).toBeNull();
      expect(result[2].sanity_flag?.reason).toBe('low_confidence');
    });

    test('uses previousItems for delta detection', () => {
      const previous = [{ item_name: 'Борщ', price_byn: 10 }];
      const items = [{ item_name: 'Борщ', price_byn: 50, confidence: 0.9 }];
      const result = check(items, previous);
      expect(result[0].sanity_flag?.reason).toBe('price_delta_anomaly');
    });
  });

  // ==========================================================================
  // Канон причин
  // ==========================================================================
  //
  // Список причин уехал наружу (`SANITY_FLAG_REASONS`), потому что фильтр очереди
  // «Позиции меню» берёт варианты только оттуда: до этого коды жили строковыми
  // литералами внутри checkItem и ни одному потребителю видны не были.
  //
  // Сторожей два, и они стерегут РАЗНОЕ. Первый — что каждая объявленная причина
  // достижима: причина, которую не может выдать ни одно правило, дала бы фильтр,
  // всегда возвращающий пусто. Второй — что ни одно правило не выдаёт причину мимо
  // канона: новое правило со свежим литералом было бы нефильтруемым на экране и
  // осталось бы без русской подписи, то есть модератор увидел бы голый код.
  describe('канон причин', () => {
    // Первая версия этих сторожей пропускала главный случай: правило с НОВОЙ
    // константой (`const REASON_DUPLICATE = 'duplicate_item'`), не внесённой в канон,
    // проходило оба теста — литерала нет, значит сканеру нечего ловить, а тест
    // достижимости собирал множество из четырёх заранее известных входов и нового
    // правила не задевал. На экране такая причина была бы нефильтруемой и без
    // русской подписи, а `?reason=duplicate_item` давал бы 400.
    //
    // Поэтому сверка идёт по ОБЪЯВЛЕНИЯМ констант, а не по достижимости.
    const source = readFileSync(
      new URL('../../services/ocr/sanityChecker.js', import.meta.url),
      'utf8',
    );

    test('объявленные константы причин и канон — одно и то же множество', () => {
      const declared = [...source.matchAll(/const\s+(REASON_[A-Z0-9_]+)\s*=\s*'([^']+)'/g)]
        .map((m) => m[2]);

      // Пустой список означал бы, что регулярное выражение разошлось с кодом, а не
      // что всё в порядке: без этой проверки тест зеленел бы на любом рефакторинге
      // объявлений.
      expect(declared.length).toBeGreaterThan(0);
      expect([...declared].sort()).toEqual([...SANITY_FLAG_REASONS].sort());
    });

    test('каждая причина канона достижима каким-то правилом', () => {
      const reached = new Set();

      // Ниже — по одному входу на правило, в порядке самих правил (первое
      // сработавшее выигрывает, поэтому входы не должны задевать предыдущие).
      reached.add(checkItem({ price_byn: 0.10, confidence: 0.99 }, new Map()).reason);
      reached.add(checkItem({ price_byn: 5000, confidence: 0.99 }, new Map()).reason);
      reached.add(checkItem({ price_byn: 20, confidence: 0.10 }, new Map()).reason);
      reached.add(
        checkItem(
          { item_name: 'Борщ', price_byn: 90, confidence: 0.99 },
          new Map([['борщ', 10]]),
        ).reason,
      );

      // Это утверждение НЕ ловит опечатку в самом значении константы: обе его
      // стороны выведены из одного места. Опечатку стерегут тесты выше по файлу,
      // пинящие литералы («price_delta_anomaly» и прочие) — они здесь несущие,
      // и удалять их как «дублирующие» нельзя.
      expect([...reached].sort()).toEqual([...SANITY_FLAG_REASONS].sort());
    });

    test('правила пишут причину только через константы канона', () => {
      // Разбор построчный, а не сквозным regex: сквозной ловил и слово «reason:»
      // внутри комментария, объясняющего сам сторож. Любая кавычка, не только
      // одинарная: `reason: "x"` и бэктик — тот же обход.
      const usages = source
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('reason:'))
        .map((line) => line.replace(/^reason:\s*/, '').replace(/,$/, '').trim());

      // Ни одного совпадения тоже нельзя считать успехом — правила могли переехать,
      // а сканер об этом не узнает.
      expect(usages.length).toBeGreaterThanOrEqual(SANITY_FLAG_REASONS.length);
      expect(usages.every((usage) => /^REASON_[A-Z0-9_]+$/.test(usage))).toBe(true);
    });

    test('канон заморожен и не пуст', () => {
      expect(Object.isFrozen(SANITY_FLAG_REASONS)).toBe(true);
      expect(SANITY_FLAG_REASONS.length).toBeGreaterThan(0);
      expect(new Set(SANITY_FLAG_REASONS).size).toBe(SANITY_FLAG_REASONS.length);
    });
  });
});
