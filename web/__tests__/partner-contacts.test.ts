/**
 * Телефон, почта и сайт проверяются в форме до отправки (сверка находок
 * тестировщика с сайтом, 18.10, пункт С6): неверное значение не уходит на
 * сервер (иначе сервер отвергает ВСЮ правку), его поле говорит, почему, и
 * ошибка одного поля не прячет остальные.
 */
import {
  acceptedForm,
  contactErrors,
  contactValue,
  normalizePhone,
} from '@/lib/partner/contacts';
import { emptyForm, toCreatePayload, toUpdatePayload } from '@/lib/partner/form';

const base = () => ({
  ...emptyForm(),
  name: 'Кафе',
  city: 'Минск',
  street: 'ул. Немига, 5',
  categories: ['Кафе'],
  cuisines: ['Народная'],
});

describe('contactValue', () => {
  it.each([
    ['+375 29 123-45-67', '+375291234567'],
    ['+375 (17) 2345678', '+375172345678'],
    ['', ''],
  ])('телефон «%s» → «%s»', (raw, sent) => {
    expect(contactValue({ ...base(), phone: raw }, 'phone')).toBe(sent);
  });

  it.each(['+37529123', '80291234567', '+375991234567'])('телефон «%s» не проходит', (raw) => {
    expect(contactValue({ ...base(), phone: raw }, 'phone')).toBeNull();
  });

  it.each(['info@kafe.by', 'a.b@почта.бел'])('почта «%s» проходит', (v) => {
    expect(contactValue({ ...base(), email: v }, 'email')).toBe(v);
  });

  it.each(['info@', 'info@kafe', 'in fo@kafe.by'])('почта «%s» не проходит', (v) => {
    expect(contactValue({ ...base(), email: v }, 'email')).toBeNull();
  });

  it.each([
    'kafe.by',
    'https://instagram.com/kafe',
    'http://сайт.бел/меню?x=1',
    'HTTPS://kafe.by',
    'https://kafe.xn--90ais',
    'ftp://kafe.by/menu',
  ])(
    'сайт «%s» проходит',
    (v) => {
      expect(contactValue({ ...base(), website: v }, 'website')).toBe(v);
    },
  );

  it.each(['kafe', 'https://', 'kafe .by'])('сайт «%s» не проходит', (v) => {
    expect(contactValue({ ...base(), website: v }, 'website')).toBeNull();
  });

  it('normalizePhone убирает пробелы, дефисы и скобки', () => {
    expect(normalizePhone(' +375 (29) 111-22-33 ')).toBe('+375291112233');
  });
});

describe('contactErrors', () => {
  it('называет каждое неверное поле — одно не прячет другие', () => {
    const errors = contactErrors({
      ...base(),
      phone: '+37529',
      email: 'info@',
      website: 'kafe',
    });
    expect(Object.keys(errors).sort()).toEqual(['email', 'phone', 'website']);
  });

  it('пустые и верные поля — без ошибок', () => {
    expect(contactErrors({ ...base(), phone: '+375291234567', email: '' })).toEqual({});
  });
});

describe('acceptedForm — что сервер хранит после сохранения', () => {
  it('контакт, не ушедший в сохранение, остаётся прежним; остальное — как отправлено', () => {
    const before = { ...base(), phone: '+375291234567', email: '' };
    const sent = { ...base(), phone: '+37529', email: 'info@kafe.by' };
    const accepted = acceptedForm(sent, before);
    expect(accepted.phone).toBe('+375291234567');
    expect(accepted.email).toBe('info@kafe.by');
  });

  it('без прежнего (создание) не ушедший контакт — пустой', () => {
    expect(acceptedForm({ ...base(), website: 'kafe' }, null).website).toBe('');
  });
});

describe('неверный контакт не уходит в сохранение, остальное уходит', () => {
  it('создание: недописанный телефон не отправляется, верная почта — отправляется', () => {
    const p = toCreatePayload({ ...base(), phone: '+37529', email: 'info@kafe.by' });
    expect('phone' in p).toBe(false);
    expect(p.email).toBe('info@kafe.by');
  });

  it('правка: недописанный телефон не отправляется (на сервере остаётся прежний), описание отправляется', () => {
    const saved = { ...base(), phone: '+375291234567' };
    const p = toUpdatePayload({ ...saved, phone: '+3752912', description: 'Уютно' }, saved);
    expect('phone' in p).toBe(false);
    expect(p.description).toBe('Уютно');
  });
});
