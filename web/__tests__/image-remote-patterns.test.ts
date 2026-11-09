/**
 * @jest-environment node
 *
 * Оптимизатор картинок (/_next/image) берёт внешние файлы только с адресов из
 * images.remotePatterns и декодирует всё, что взял, — поэтому брать он должен
 * только из нашего хранилища (уязвимости декодеров вроде GHSA-2xp9-vwfh-vxw4
 * закрывает обновление next; узкий список держит поверхность малой между
 * обновлениями). Шаблон `res.cloudinary.com/**` пускал файлы из любого
 * аккаунта Cloudinary — теперь только из нашего.
 *
 * Проверка идёт настоящим сопоставителем Next (hasRemoteMatch) — тем же, что
 * решает в /_next/image, — по настоящему next.config.ts. Имя облака —
 * литерал: на 30.09.2026 все 278 картинок каталога прода (список, карточки,
 * отзывы) лежат в нём.
 */
import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern';

import nextConfig from '../next.config';

const OUR_CLOUD = 'davrzdre8';
// Папка владельца в облаке — UUID (backend config/cloudinary.js, ownedFolders).
const CARD = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

// Оптимизатор Next 16 сверяет адрес с ДВУМЯ списками: устаревшим
// images.domains и remotePatterns (next/dist/server/image-optimizer.js —
// hasRemoteMatch(domains, remotePatterns, …)). Сопоставитель получает оба
// списка из настоящего конфига, как в /_next/image, — иначе хост, вписанный в
// domains, прошёл бы мимо всех проверок ниже.
const allowed = (url: string) =>
  hasRemoteMatch(
    nextConfig.images?.domains ?? [],
    nextConfig.images?.remotePatterns ?? [],
    new URL(url),
  );

describe('images.remotePatterns — Cloudinary только нашего аккаунта', () => {
  it('картинка из нашего облака проходит, в том числе с меткой SDK ?_a=', () => {
    expect(
      allowed(`https://res.cloudinary.com/${OUR_CLOUD}/image/upload/v1759000000/establishments/a/photo.jpg`),
    ).toBe(true);
    expect(
      allowed(`https://res.cloudinary.com/${OUR_CLOUD}/image/upload/c_fill,w_600/v1/establishments/b/menu.webp?_a=BAMAPqfi0`),
    ).toBe(true);
  });

  it('файл из чужого аккаунта Cloudinary — нет', () => {
    expect(allowed('https://res.cloudinary.com/demo/image/upload/v1/evil.avif')).toBe(false);
  });

  it('аккаунт, чьё имя начинается с нашего, — тоже нет', () => {
    expect(allowed(`https://res.cloudinary.com/${OUR_CLOUD}x/image/upload/v1/evil.avif`)).toBe(false);
  });

  // «Только из нашего хранилища» — и по хосту: проверки выше меняют путь и
  // схему у хоста Cloudinary, и шаблон с любым хостом их бы не заметил.
  it('чужой хост — нет, даже с путём нашего облака', () => {
    expect(allowed(`https://evil.example/${OUR_CLOUD}/image/upload/v1/photo.jpg`)).toBe(false);
    expect(allowed(`https://res.cloudinary.com.evil.example/${OUR_CLOUD}/image/upload/v1/photo.jpg`)).toBe(false);
  });

  it('устаревший список images.domains пуст: хосты задаёт только remotePatterns', () => {
    expect(nextConfig.images?.domains ?? []).toEqual([]);
  });

  // Нитка «Расходы посторонних», п. 8 (03.11.2026): заглушки ранней базы
  // больше не нужны, а из нашего облака — только загруженные картинки.
  it('заглушки fastly.picsum.photos — нет', () => {
    expect(allowed('https://fastly.picsum.photos/id/1/600/400.jpg')).toBe(false);
  });

  it('другие типы выдачи нашего облака (видео, raw, fetch) — нет', () => {
    expect(allowed(`https://res.cloudinary.com/${OUR_CLOUD}/video/upload/v1/clip.mp4`)).toBe(false);
    expect(allowed(`https://res.cloudinary.com/${OUR_CLOUD}/raw/upload/v1/file.bin`)).toBe(false);
    expect(allowed(`https://res.cloudinary.com/${OUR_CLOUD}/image/fetch/https://example.com/a.jpg`)).toBe(false);
  });

  it('оптимизатор качает не больше 5 МБ одного файла (PDF-меню лежат рядом с фото)', () => {
    expect(nextConfig.images?.maximumResponseBody).toBe(5_000_000);
  });

  // Все формы ссылок на фото карточек, что выдаёт сервер (backend
  // config/cloudinary.js: generateImageUrl, ISSUED_PHOTO_LINK_FORMS, secure_url
  // загрузки; папки — uploadImage и загрузки мастера партнёра temp/<id>).
  it.each([
    ['оригинал', `c_limit,w_1920/f_auto,fl_progressive,q_auto/v1/establishments/${CARD}/interior/abc123`],
    ['оригинал до 20.07.2026', `c_limit,h_1080,w_1920/f_auto,fl_progressive,q_auto/v1/establishments/${CARD}/menu/abc123`],
    ['превью', `c_limit,w_1200/f_auto,fl_progressive,q_auto/v1/establishments/${CARD}/dishes/abc123`],
    ['миниатюра', `c_fill,h_300,w_400/f_auto,fl_progressive,q_auto/v1/establishments/${CARD}/exterior/abc123`],
    ['обложка PDF-меню', `c_fill,h_300,pg_1,w_400/f_jpg,q_auto/v1762000000/establishments/${CARD}/menu_pdf/abc123.jpg`],
    ['ссылка загрузки как есть', `v1762000000/establishments/${CARD}/promotions/abc123.jpg`],
    ['без версии', `establishments/${CARD}/interior/abc123.jpg`],
    ['загрузка мастера партнёра', `c_limit,w_1920/f_auto,fl_progressive,q_auto/v1/establishments/temp/${CARD}/interior/abc123`],
  ])('фото карточки проходит: %s', (_form, path) => {
    expect(allowed(`https://res.cloudinary.com/${OUR_CLOUD}/image/upload/${path}`)).toBe(true);
  });

  // Сайт не хранит копий фото людей: 09.11.2026 на проде копия фото профиля в
  // кэше /_next/image отдавалась после удаления учётной записи (облако — 404,
  // сайт — 200). Страницы фото профиля ведут мимо оптимизатора
  // (lib/avatar-source); здесь — что и прямой адрес /_next/image?url=<фото из
  // avatars/> получает отказ 400. Сторож: краснеет, если папка avatars/ снова
  // попадёт в remotePatterns — в любой форме, какую понимает облако.
  it.each([
    ['ссылка загрузки', `v1791566923/avatars/${CARD}/photo.jpg`],
    ['без версии', `avatars/${CARD}/photo.jpg`],
    ['без расширения', `v1/avatars/${CARD}/photo`],
    ['с разрешённой строкой преобразования', `c_limit,w_1920/f_auto,fl_progressive,q_auto/v1/avatars/${CARD}/photo`],
    ['с одним сегментом преобразования', `c_fill,h_300,w_400/v1/avatars/${CARD}/photo.jpg`],
    ['папка, записанная кодами (%61 = a)', `v1/%61vatars/${CARD}/photo.jpg`],
    ['обход через ../ после папки карточек', `establishments/../avatars/${CARD}/photo.jpg`],
    ['обход через %2e%2e после папки карточек', `establishments/%2e%2e/avatars/${CARD}/photo.jpg`],
  ])('фото профиля из avatars/ — нет: %s', (_form, path) => {
    expect(allowed(`https://res.cloudinary.com/${OUR_CLOUD}/image/upload/${path}`)).toBe(false);
  });

  it('из нашего облака — только папка карточек establishments/', () => {
    expect(allowed(`https://res.cloudinary.com/${OUR_CLOUD}/image/upload/v1/sample.jpg`)).toBe(false);
    expect(allowed(`https://res.cloudinary.com/${OUR_CLOUD}/image/upload/v1/other/${CARD}/a.jpg`)).toBe(false);
    expect(allowed(`https://res.cloudinary.com/${OUR_CLOUD}/image/upload/v1/establishmentsx/${CARD}/a.jpg`)).toBe(false);
  });

  it('наше облако — только по https', () => {
    expect(allowed(`http://res.cloudinary.com/${OUR_CLOUD}/image/upload/v1/photo.jpg`)).toBe(false);
  });
});
