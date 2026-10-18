/**
 * Тексты отказов кабинета партнёра (сверка находок тестировщика с сайтом,
 * 18.10, пункты С5, С6, Х17): русский текст сервера — как есть, английский —
 * заменяется текстом сайта; отказ проверки полей называет поля; суточный
 * предел загрузок — со сроком; лимит PDF и занятый адрес страницы — своими
 * фразами, а не общей «Не удалось выполнить запрос».
 */
import { formatWait, refusalMessage } from '@/lib/partner/errors';

const FALLBACK = 'Не удалось выполнить запрос. Попробуйте позже.';

describe('refusalMessage — чей текст видит партнёр', () => {
  it('русский текст сервера показывается как есть, а не общей фразой по коду', () => {
    const server =
      'Нет доступа к этому заведению — возможно, оно удалено или принадлежит другому аккаунту. Обновите список заведений.';
    expect(refusalMessage({ code: 'FORBIDDEN', message: server })).toBe(server);
  });

  it('английский текст сервера заменяется русским по коду', () => {
    expect(
      refusalMessage({
        code: 'PDF_LIMIT_EXCEEDED',
        message: 'Maximum 2 PDF menu files allowed per establishment',
      }),
    ).toBe('Можно добавить не больше 2 файлов меню в формате PDF.');
  });

  it('незнакомый код с английским текстом — нейтральная русская фраза, не английский', () => {
    expect(refusalMessage({ code: 'SOMETHING_NEW', message: 'Internal thing failed' })).toBe(
      FALLBACK,
    );
  });

  it('отказ проверки полей называет каждое поле, а не «Проверьте правильность заполнения полей»', () => {
    const text = refusalMessage({
      code: 'VALIDATION_ERROR',
      fields: [{ field: 'phone' }, { field: 'email' }],
    });
    expect(text).toBe(
      'Не сохранено. Проверьте: Телефон — в формате +375XXXXXXXXX; Почта — адрес вида name@example.by.',
    );
  });

  it('русский текст поля от сервера идёт как есть', () => {
    expect(
      refusalMessage({
        code: 'VALIDATION_ERROR',
        fields: [{ field: 'categories', message: 'Такой категории нет в списке.' }],
      }),
    ).toBe('Не сохранено. Проверьте: Такой категории нет в списке.');
  });

  it('проверка полей без известных полей — общая фраза по коду', () => {
    expect(refusalMessage({ code: 'VALIDATION_ERROR', fields: [{ field: 'id' }] })).toBe(
      'Проверьте правильность заполнения полей.',
    );
  });

  it('суточный предел загрузок — со сроком, даже когда у сервера свой русский текст', () => {
    expect(
      refusalMessage({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Лимит загрузок на сегодня исчерпан. Продолжите завтра.',
        limit: 'daily_uploads',
        retryAfter: 3 * 3600 + 5 * 60,
      }),
    ).toBe(
      'Лимит загрузок на сегодня исчерпан. Загрузить снова можно через 3 ч 5 мин — после полуночи.',
    );
  });

  it('суточный предел без срока — без числа', () => {
    expect(refusalMessage({ code: 'RATE_LIMIT_EXCEEDED', limit: 'daily_uploads' })).toBe(
      'Лимит загрузок на сегодня исчерпан. Загрузить снова можно после полуночи.',
    );
  });

  it('предел запросов — свой срок', () => {
    expect(
      refusalMessage({ code: 'RATE_LIMIT_EXCEEDED', limit: 'requests', retryAfter: 42 }),
    ).toBe('Слишком много запросов подряд. Попробуйте через 42 сек.');
  });

  it('занятый адрес страницы — своя фраза вместо общей', () => {
    expect(
      refusalMessage({
        code: 'SLUG_COLLISION',
        message: 'Не удалось сохранить карточку. Попробуйте ещё раз.',
      }),
    ).toBe(
      'Адрес страницы для этого названия только что занят. Сохраните ещё раз — сайт подберёт свободный.',
    );
  });
});

describe('formatWait', () => {
  it.each([
    [40, '40 сек'],
    [60, '1 мин'],
    [61, '2 мин'],
    [3600, '1 ч'],
    [3601, '1 ч 1 мин'],
    [7 * 3600 + 59 * 60, '7 ч 59 мин'],
  ])('%i с → «%s»', (seconds, text) => {
    expect(formatWait(seconds)).toBe(text);
  });
});
