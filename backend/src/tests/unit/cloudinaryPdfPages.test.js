/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Ссылка на страницу PDF для распознавания (config/cloudinary.js
 * generatePdfPageImageUrl) — подписана: при строгом режиме облако создаёт новый
 * вариант только по подписи, а страниц pg_1…pg_20 слишком много, чтобы
 * разрешать их в панели (нитка «Расходы посторонних», п. 8). Подпись считается
 * здесь заново по правилу из документации Cloudinary, а не копируется из кода:
 * SHA-1 от «преобразование/public_id.формат» + секрет, base64url, 8 знаков.
 */

import crypto from 'node:crypto';
import { generatePdfPageImageUrl } from '../../config/cloudinary.js';

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const PUBLIC_ID = 'establishments/0b6e9a52-3f1d-4c8e-9a7b-2d4c6e8f0a1b/menu_pdf/abc123';
const STORED = `https://res.cloudinary.com/${CLOUD}/image/upload/v1759000000/${PUBLIC_ID}.pdf`;

const signature = (page) => {
  const digest = crypto.createHash('sha1')
    .update(`pg_${page}/${PUBLIC_ID}.jpg${process.env.CLOUDINARY_API_SECRET}`)
    .digest('base64url');
  return digest.slice(0, 8);
};

const signedPage = (page, version = 'v1759000000') => (
  `https://res.cloudinary.com/${CLOUD}/image/upload/s--${signature(page)}--/pg_${page}/${version}/${PUBLIC_ID}.jpg`
);

/** Без метки SDK ?_a=…: её дописывает SDK ко всем своим ссылкам, в подпись она не входит. */
const pageLink = (stored, page) => generatePdfPageImageUrl(stored, page).split('?')[0];

describe('generatePdfPageImageUrl', () => {
  test('страница — картинкой, с подписью, версией сохранённой ссылки и по https', () => {
    expect(pageLink(STORED, 2)).toBe(signedPage(2));
  });

  test('у каждой страницы своя подпись', () => {
    expect(signature(1)).not.toBe(signature(2));
    expect(pageLink(STORED, 1)).toBe(signedPage(1));
    expect(pageLink(STORED, 20)).toBe(signedPage(20));
  });

  test('метка SDK в конце сохранённой ссылки не мешает разобрать её', () => {
    expect(pageLink(`${STORED}?_a=BAMAPqfi0`, 3)).toBe(signedPage(3));
  });

  test('сохранённая ссылка без расширения — та же картинка', () => {
    expect(pageLink(STORED.replace(/\.pdf$/, ''), 2)).toBe(signedPage(2));
  });

  test('ссылка без версии: SDK ставит v1, подпись та же', () => {
    const stored = `https://res.cloudinary.com/${CLOUD}/image/upload/${PUBLIC_ID}.pdf`;

    expect(pageLink(stored, 2)).toBe(signedPage(2, 'v1'));
  });
});
