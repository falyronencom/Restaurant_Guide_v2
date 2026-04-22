/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: pdfTextExtractor.js
 *
 * Focus: hasUsableTextLayer heuristic — the decision gate that determines
 * whether the orchestrator uses pdf-parse output directly or falls back to
 * vision OCR. Testing this in isolation avoids real PDF I/O.
 */

import {
  hasUsableTextLayer,
  computePrintableRatio,
  MIN_AVG_CHARS_PER_PAGE,
  MIN_DIGIT_COUNT,
  MIN_PRINTABLE_RATIO,
} from '../../services/ocr/pdfTextExtractor.js';

describe('pdfTextExtractor heuristics', () => {
  describe('computePrintableRatio', () => {
    test('returns 0 for empty string', () => {
      expect(computePrintableRatio('')).toBe(0);
      expect(computePrintableRatio(null)).toBe(0);
    });

    test('returns 1.0 for plain ASCII text', () => {
      expect(computePrintableRatio('Hello World 123')).toBe(1.0);
    });

    test('returns 1.0 for Cyrillic text', () => {
      expect(computePrintableRatio('Борщ 15 руб')).toBe(1.0);
    });

    test('handles whitespace as printable', () => {
      expect(computePrintableRatio('abc\n\tdef')).toBe(1.0);
    });

    test('drops ratio when control chars dominate', () => {
      const garbage = '\x01\x02\x03\x04\x05\x06abc';
      const ratio = computePrintableRatio(garbage);
      expect(ratio).toBeCloseTo(3 / 9, 2);
    });
  });

  describe('hasUsableTextLayer', () => {
    test('rejects empty text', () => {
      expect(hasUsableTextLayer('', 5)).toBe(false);
    });

    test('rejects zero pages', () => {
      expect(hasUsableTextLayer('Some reasonable text content 123', 0)).toBe(false);
    });

    test('rejects text below min avg chars per page', () => {
      const short = 'Short';
      expect(hasUsableTextLayer(short, 1)).toBe(false);
    });

    test('rejects text with no digits', () => {
      const noDigits = 'A'.repeat(MIN_AVG_CHARS_PER_PAGE * 2);
      expect(hasUsableTextLayer(noDigits, 1)).toBe(false);
    });

    test('rejects text with garbage printable ratio', () => {
      const printable = 'Menu 1 2 3 ';
      const garbage = '\x01'.repeat(100);
      const mixed = printable + garbage;
      expect(hasUsableTextLayer(mixed, 1)).toBe(false);
    });

    test('accepts a valid menu page', () => {
      const realMenu =
        'Борщ украинский — 15 руб.\nСалат Цезарь — 12 руб.\n' +
        'Пицца Маргарита — 18 руб.\nКофе эспрессо — 4 руб.';
      expect(realMenu.length).toBeGreaterThan(MIN_AVG_CHARS_PER_PAGE);
      expect(hasUsableTextLayer(realMenu, 1)).toBe(true);
    });

    test('boundary: exactly at MIN_AVG_CHARS_PER_PAGE with digits passes', () => {
      const base = 'x'.repeat(MIN_AVG_CHARS_PER_PAGE);
      const withDigits = base + '1'.repeat(MIN_DIGIT_COUNT);
      expect(hasUsableTextLayer(withDigits, 1)).toBe(true);
    });

    test('boundary: just below MIN_DIGIT_COUNT fails', () => {
      const base = 'x'.repeat(MIN_AVG_CHARS_PER_PAGE);
      const tooFewDigits = base + '1'.repeat(MIN_DIGIT_COUNT - 1);
      expect(hasUsableTextLayer(tooFewDigits, 1)).toBe(false);
    });

    test('multi-page PDF with avg per page below threshold fails', () => {
      // 100 chars across 10 pages = 10 chars/page, below threshold
      const text = 'abc 123 xyz'.repeat(10);
      expect(hasUsableTextLayer(text, 10)).toBe(false);
    });

    test('constants are exported and finite', () => {
      expect(MIN_AVG_CHARS_PER_PAGE).toBeGreaterThan(0);
      expect(MIN_DIGIT_COUNT).toBeGreaterThan(0);
      expect(MIN_PRINTABLE_RATIO).toBeGreaterThan(0);
      expect(MIN_PRINTABLE_RATIO).toBeLessThanOrEqual(1);
    });
  });
});
