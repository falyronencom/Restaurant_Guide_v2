/**
 * serializeJsonLd — JSON для тела <script type="application/ld+json">.
 *
 * Внутри <script> браузер ищет только конец тега, и голый JSON.stringify его не
 * экранирует (внешний обзор 23.09.2026, #2). Сериализатор заменяет каждый «<»
 * его escape-последовательностью u003c — так не закрыть тег и не открыть
 * комментарий «<!--» — и заодно
 * U+2028/U+2029, как советует руководство Next по JSON-LD. Результат — тот же
 * JSON: JSON.parse возвращает исходные данные.
 */
import { serializeJsonLd } from '@/lib/json-ld';

// Через fromCharCode, а не escape-последовательностью в исходнике: сырой
// U+2028 в коде — конец строки.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

const HOSTILE = {
  name: '</script><script>alert(1)</script>',
  comment: '<!--<script>',
  separators: `a${LS}b${PS}c`,
  nested: [{ text: '</SCRIPT >', n: 5, ok: true, none: null }],
  harmless: 'a > b && c',
};

describe('serializeJsonLd', () => {
  test('в выводе нет ни одного «<»: каждый заменён на \\u003c', () => {
    const out = serializeJsonLd(HOSTILE);

    expect(out).not.toContain('<');
    expect(out.match(/\\u003c/g)).toHaveLength(6);
  });

  test('U+2028 и U+2029 выходят экранированными', () => {
    const out = serializeJsonLd(HOSTILE);

    expect({ LS: out.includes(LS), PS: out.includes(PS) }).toEqual({ LS: false, PS: false });
    expect(out).toContain('a\\u2028b\\u2029c');
  });

  test('это тот же JSON: разбор возвращает исходные данные', () => {
    expect(JSON.parse(serializeJsonLd(HOSTILE))).toEqual(HOSTILE);
  });

  test('безопасное внутри <script> не трогает: «>» и «&» остаются как есть', () => {
    expect(serializeJsonLd({ harmless: HOSTILE.harmless })).toBe('{"harmless":"a > b && c"}');
  });
});
