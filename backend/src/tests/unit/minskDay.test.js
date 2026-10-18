/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Календарные сутки продукта — минские (Europe/Minsk, UTC+3 без перевода
 * часов). Квота отзывов сбрасывается в полночь Минска (решение Координатора
 * 11.10.2026, закрывает 23.09 #26), и граница считается по именованному поясу,
 * а не по часам процесса: на проде процесс в UTC, в CI — в Europe/Minsk.
 *
 * Все моменты заданы в UTC-литералах: полночь Минска — это 21:00 UTC.
 */

import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { minskDate, secondsUntilMinskMidnight } from '../../utils/minskDay.js';

const MODULE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'utils', 'minskDay.js');

describe('secondsUntilMinskMidnight — граница суток по Минску, не по процессу', () => {
  test.each([
    ['за секунду до полуночи Минска (20:59:59Z)', '2026-10-11T20:59:59Z', 1],
    ['ровно полночь Минска (21:00:00Z) — новые сутки, впереди полные', '2026-10-11T21:00:00Z', 86400],
    ['секунда после полуночи Минска (21:00:01Z)', '2026-10-11T21:00:01Z', 86399],
    ['полдень Минска (09:00:00Z)', '2026-10-11T09:00:00Z', 43200],
    ['полночь UTC — в Минске уже 03:00', '2026-10-11T00:00:00Z', 75600],
    ['зимняя дата — пояс без перевода часов, те же +3', '2026-01-15T20:59:30Z', 30],
  ])('%s: %s → %i с', (_label, iso, expected) => {
    expect(secondsUntilMinskMidnight(new Date(iso))).toBe(expected);
  });

  test('никогда не отдаёт ноль и не превышает сутки', () => {
    for (let h = 0; h < 24; h += 1) {
      const value = secondsUntilMinskMidnight(new Date(Date.UTC(2026, 9, 11, h, 0, 0)));
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(86400);
    }
  });
});

describe('minskDate — дата суток Минска для счётчиков суточного предела загрузок', () => {
  test.each([
    ['за секунду до полуночи Минска — ещё 17-е', '2026-10-17T20:59:59Z', '2026-10-17'],
    ['полночь Минска — уже 18-е, в UTC ещё 17-е', '2026-10-17T21:00:00Z', '2026-10-18'],
    ['полночь UTC — в Минске 03:00 того же дня', '2026-10-18T00:00:00Z', '2026-10-18'],
    ['Новый год в Минске наступает в 21:00 UTC 31 декабря', '2025-12-31T21:00:00Z', '2026-01-01'],
    ['за секунду до него — ещё старый год', '2025-12-31T20:59:59Z', '2025-12-31'],
    ['однозначные месяц и день — с нулём впереди', '2026-03-04T12:00:00Z', '2026-03-04'],
  ])('%s: %s → %s', (_label, iso, expected) => {
    expect(minskDate(new Date(iso))).toBe(expected);
  });
});

// «Не по часам процесса»: набор идёт под Europe/Minsk (CI), где пояс процесса
// и пояс продукта совпадают — там ответ по часам процесса неотличим от ответа
// по именованному поясу. Здесь тот же модуль считает в отдельном процессе с
// другим поясом: UTC (прод) и Pacific/Kiritimati (+14, далеко от обоих).
describe('граница суток не зависит от пояса процесса', () => {
  const INSTANTS = [
    '2026-10-11T20:59:59Z', // 23:59:59 в Минске
    '2026-10-11T21:00:00Z', // полночь Минска
    '2026-10-11T09:00:00Z', // полдень Минска
    '2026-10-18T00:00:00Z', // полночь UTC — в Минске 03:00
    '2025-12-31T21:00:00Z', // Новый год в Минске
  ];

  test.each(['UTC', 'Pacific/Kiritimati'])('в процессе с поясом %s — те же даты и те же секунды', (tz) => {
    const script = `
      import { minskDate, secondsUntilMinskMidnight } from ${JSON.stringify(pathToFileURL(MODULE).href)};
      const out = ${JSON.stringify(INSTANTS)}.map((iso) => [minskDate(new Date(iso)), secondsUntilMinskMidnight(new Date(iso))]);
      console.log(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, out }));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    });
    expect(child.stderr).toBe('');
    const { zone, out } = JSON.parse(child.stdout);

    expect(zone).toBe(tz); // процесс и правда в этом поясе
    expect(out).toEqual([
      ['2026-10-11', 1],
      ['2026-10-12', 86400],
      ['2026-10-11', 43200],
      ['2026-10-18', 75600],
      ['2026-01-01', 86400],
    ]);
  });
});
