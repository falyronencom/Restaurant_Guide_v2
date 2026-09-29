/**
 * Unit — перераспознавание меню, выбор файлов --media (scripts/reocr-menus/plan.js, onlyMedia).
 *
 * Зачем (29.09.2026, составные меню): после правки инструкции решено
 * перераспознать один файл (Zalkind), а скрипт умел только все файлы сразу —
 * --apply поставил бы в очередь 110 файлов 28 карточек и заменил их позиции.
 * Опечатка в id не должна молча давать пустой план.
 */
import { onlyMedia } from '../../../scripts/reocr-menus/plan.js';

const row = (media_id, extra = {}) => ({ media_id, name: `Карточка ${media_id}`, items: 1, ...extra });

describe('onlyMedia — только названные файлы', () => {
  const plan = {
    targets: [row('a'), row('b'), row('c')],
    skipped: [row('d', { reason: 'задача уже в очереди' }), row('e', { reason: 'формат не читается' })],
  };

  test('в плане остаются только названные файлы — и в очереди, и среди пропущенных', () => {
    expect(onlyMedia(plan, ['b', 'd'])).toEqual({
      targets: [row('b')],
      skipped: [row('d', { reason: 'задача уже в очереди' })],
    });
  });

  test('пропущенный по правилам файл не становится целью оттого, что его назвали', () => {
    expect(onlyMedia(plan, ['d']).targets).toEqual([]);
  });

  test('неизвестный id — ошибка с этим id, а не пустой план', () => {
    expect(() => onlyMedia(plan, ['a', 'zzz'])).toThrow(/zzz/);
  });
});
