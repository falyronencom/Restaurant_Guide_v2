/**
 * Сторож мест, где строка становится HTML: в web/src они только в двух
 * разрешённых файлах.
 *
 * Класс дефекта — внешний обзор 23.09.2026, #2: JSON-LD вставлялся через
 * `dangerouslySetInnerHTML` с голым JSON.stringify в трёх компонентах, и текст
 * отзыва, карточки или позиции меню закрывал <script> и исполнялся на странице.
 * Исправление свело вставку JSON-LD в один компонент (JsonLdScript), а его
 * содержимое — в один сериализатор (serializeJsonLd). Сторож держит это
 * устройство: новое место вставки HTML в web/src краснит тест, пока его не
 * впишут в ALLOWED вместе с причиной.
 *
 * Сторож сканирующий, и зеленеет он двумя способами: мест нет — или сломан сам
 * поиск. Второй способ беззвучен, поэтому поиск проверен якорем на литерале,
 * не зависящем от сканируемых файлов (первый тест).
 *
 * Как выключить сторож, не изменив вывода прогона? Только вписав файл в
 * ALLOWED — и тогда причина стоит рядом.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';

const SRC = resolve(__dirname, '..', 'src');

const SINKS: { name: string; pattern: RegExp }[] = [
  { name: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML\s*[=:]/g },
  { name: 'innerHTML =', pattern: /\.innerHTML\s*\+?=(?!=)/g },
  // То же присваивание через скобки: el['innerHTML'] = …
  { name: 'innerHTML =', pattern: /\[\s*(['"`])innerHTML\1\s*\]\s*\+?=(?!=)/g },
  { name: 'outerHTML =', pattern: /\.outerHTML\s*\+?=(?!=)/g },
  { name: 'outerHTML =', pattern: /\[\s*(['"`])outerHTML\1\s*\]\s*\+?=(?!=)/g },
  // Ключ объекта, который присваивается элементу: Object.assign(el, { innerHTML: … }).
  // Не после точки — иначе тернарник `c ? el.innerHTML : d` читался бы как ключ.
  { name: 'innerHTML =', pattern: /(?<![.\w])(['"`]?)innerHTML\1\s*:/g },
  { name: 'outerHTML =', pattern: /(?<![.\w])(['"`]?)outerHTML\1\s*:/g },
  // Встроенный документ iframe: строка в srcdoc исполняется как HTML.
  // JSX-проп srcDoc={…}, свойство el.srcdoc = …, ключ { srcDoc: … },
  // скобки el['srcdoc'] = … и setAttribute('srcdoc', …).
  { name: 'srcdoc', pattern: /\bsrc[dD]oc\s*(?:\+?=(?!=)|:)/g },
  { name: 'srcdoc', pattern: /\[\s*(['"`])srcdoc\1\s*\]\s*\+?=(?!=)/gi },
  { name: 'srcdoc', pattern: /\.setAttribute\s*\(\s*(['"`])srcdoc\1/gi },
  { name: 'insertAdjacentHTML', pattern: /\.insertAdjacentHTML\s*\(/g },
  { name: 'document.write', pattern: /\bdocument\.write(?:ln)?\s*\(/g },
  { name: 'createContextualFragment', pattern: /\.createContextualFragment\s*\(/g },
  { name: 'setHTMLUnsafe', pattern: /\.setHTMLUnsafe\s*\(/g },
];

/** Названия найденных мест вставки HTML, по одному на вхождение. */
const findSinks = (source: string): string[] =>
  SINKS.flatMap(({ name, pattern }) => [...source.matchAll(pattern)].map(() => name));

/** Разрешённые места: файл (от web/src) → что там стоит и почему это безопасно. */
const ALLOWED = new Map<string, { sinks: string[]; reason: string }>([
  ['components/JsonLdScript.tsx', {
    sinks: ['dangerouslySetInnerHTML'],
    reason: 'единственная вставка JSON-LD; содержимое готовит serializeJsonLd (экранирует «<», U+2028, U+2029)',
  }],
  ['components/map/MapView.tsx', {
    sinks: ['innerHTML ='],
    reason: 'статичный SVG значка на карте: из данных в строку попадает только цвет, выбранный из двух литералов',
  }],
]);

const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });

const rel = (path: string) => relative(SRC, path).split('\\').join('/');

describe('места вставки HTML в web/src', () => {
  test('поиск видит каждую перечисленную форму и не видит сравнение (якорь на литерале)', () => {
    const literal = [
      '<script dangerouslySetInnerHTML={{ __html: a }} />',
      'createElement("div", { dangerouslySetInnerHTML: { __html: a } })',
      'el.innerHTML = a;',
      'el.innerHTML += a;',
      'el.outerHTML = a;',
      'el.insertAdjacentHTML("beforeend", a);',
      'document.write(a); document.writeln(a);',
      'range.createContextualFragment(a);',
      'el.setHTMLUnsafe(a);',
      "el['innerHTML'] = a;",
      'el["outerHTML"] += a;',
      '<iframe srcDoc={a} />',
      'frame.srcdoc = a;',
      'createElement("iframe", { srcDoc: a })',
      "frame['srcdoc'] = a;",
      "frame.setAttribute('srcdoc', a);",
      'Object.assign(el, { innerHTML: a });',
      "Object.assign(el, { 'outerHTML': a });",
      // Не места вставки: сравнение и чтение.
      'if (el.innerHTML === a || el.innerHTML == b) { const c = el.innerHTML; }',
      "if (el['innerHTML'] === a || frame.srcdoc === b) { const c = el['innerHTML']; }",
      'const d = c ? el.innerHTML : el.outerHTML;',
    ].join('\n');

    expect(findSinks(literal).sort()).toEqual([
      'createContextualFragment',
      'dangerouslySetInnerHTML',
      'dangerouslySetInnerHTML',
      'document.write',
      'document.write',
      'innerHTML =',
      'innerHTML =',
      'innerHTML =',
      'innerHTML =',
      'insertAdjacentHTML',
      'outerHTML =',
      'outerHTML =',
      'outerHTML =',
      'setHTMLUnsafe',
      'srcdoc',
      'srcdoc',
      'srcdoc',
      'srcdoc',
      'srcdoc',
    ]);
  });

  test('каждое место стоит в ALLOWED, и число мест совпадает', () => {
    const found = new Map<string, string[]>();
    for (const file of sourceFiles(SRC)) {
      const sinks = findSinks(readFileSync(file, 'utf8'));
      if (sinks.length > 0) found.set(rel(file), sinks.sort());
    }

    const allowed = new Map([...ALLOWED].map(([file, { sinks }]) => [file, [...sinks].sort()]));
    expect(Object.fromEntries(found)).toEqual(Object.fromEntries(allowed));
  });

  test('вставка JSON-LD получает строку только от serializeJsonLd', () => {
    const source = readFileSync(join(SRC, 'components/JsonLdScript.tsx'), 'utf8');

    expect(source).toMatch(/dangerouslySetInnerHTML=\{\{\s*__html:\s*serializeJsonLd\(/);
  });

  // Причина исключения MapView — утверждение о содержимом строки, а счёт мест
  // выше видит только их число. Здесь проверена сама причина: справа от
  // присваивания одни литералы, единственная подстановка — ${fill}, а fill —
  // выбор из двух литералов цвета.
  test('значок карты: в HTML из данных попадает только цвет из двух литералов', () => {
    const source = readFileSync(join(SRC, 'components/map/MapView.tsx'), 'utf8');

    expect(source).toMatch(
      /const fill = \w+ === '[^'\n]*' \? '#[0-9A-Fa-f]{6}' : '#[0-9A-Fa-f]{6}';/,
    );

    const start = source.indexOf('el.innerHTML =');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf(';', source.indexOf("</svg>'", start));
    const rhs = source.slice(start + 'el.innerHTML ='.length, end);

    const literals = /'[^'\n]*'|`[^`]*`/g;
    const interpolations = [...rhs.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]);
    expect(interpolations).toEqual(['fill']);
    // Ничего, кроме литералов, склеенных «+».
    expect(rhs.replace(literals, '').replace(/[\s+]/g, '')).toBe('');
  });

  test('у каждого исключения есть причина', () => {
    for (const [file, { reason }] of ALLOWED) {
      expect({ file, reason: reason.length > 20 }).toEqual({ file, reason: true });
    }
  });
});
