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

const allowed = (url: string) =>
  hasRemoteMatch([], nextConfig.images?.remotePatterns ?? [], new URL(url));

describe('images.remotePatterns — Cloudinary только нашего аккаунта', () => {
  it('картинка из нашего облака проходит, в том числе с меткой SDK ?_a=', () => {
    expect(
      allowed(`https://res.cloudinary.com/${OUR_CLOUD}/image/upload/v1759000000/establishments/a/photo.jpg`),
    ).toBe(true);
    expect(
      allowed(`https://res.cloudinary.com/${OUR_CLOUD}/image/upload/c_fill,w_600/v1/b/menu.webp?_a=BAMAPqfi0`),
    ).toBe(true);
  });

  it('файл из чужого аккаунта Cloudinary — нет', () => {
    expect(allowed('https://res.cloudinary.com/demo/image/upload/v1/evil.avif')).toBe(false);
  });

  it('аккаунт, чьё имя начинается с нашего, — тоже нет', () => {
    expect(allowed(`https://res.cloudinary.com/${OUR_CLOUD}x/image/upload/v1/evil.avif`)).toBe(false);
  });

  it('наше облако — только по https', () => {
    expect(allowed(`http://res.cloudinary.com/${OUR_CLOUD}/image/upload/v1/photo.jpg`)).toBe(false);
  });
});
