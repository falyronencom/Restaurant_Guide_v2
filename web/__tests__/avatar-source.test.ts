/**
 * @jest-environment node
 *
 * Откуда сайт берёт аватар автора отзыва (lib/avatar-source). Браузер гостя
 * обращается к серверу, с которого идёт фото, — поэтому грузятся только фото
 * входа через Google и Яндекс и фото из нашего облака, все напрямую (сайт не
 * хранит копий фото людей); любой другой адрес не грузится вовсе: на карточке
 * буква.
 *
 * Список хостов входа закреплён литералом: добавить хост — продуктовое
 * решение (чьи серверы видят адреса гостей), а не правка ради зелёного
 * прогона. Что оптимизатор ни одного из этих адресов не возьмёт, проверяется
 * настоящим сопоставителем Next (hasRemoteMatch) по настоящему next.config.ts —
 * тем же, что решает в /_next/image.
 */
import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern';

import nextConfig from '../next.config';
import { SIGN_IN_AVATAR_SOURCES, avatarSource } from '@/lib/avatar-source';

const GOOGLE = 'https://lh3.googleusercontent.com/a/ACg8ocTestAvatar0123456789=s96-c';
const YANDEX = 'https://avatars.yandex.net/get-yapic/12345/abcDEF-678/islands-200';
const OUR_CLOUD =
  'https://res.cloudinary.com/davrzdre8/image/upload/v1791566923/avatars/user-1/photo.jpg';

// Адреса, которые не грузятся: у каждого — какую ошибку правила он ловит.
const REFUSED: Array<[string, string]> = [
  ['https://tracker.example/pixel.png', 'чужой сайт'],
  ['https://tracker.example/pixel.svg', 'svg с чужого сайта (next/image грузил бы его напрямую)'],
  ['http://lh3.googleusercontent.com/a/x', 'Google, но не https'],
  ['https://lh3.googleusercontent.com.tracker.example/a/x', 'хост начинается с хоста Google'],
  ['https://xlh3.googleusercontent.com/a/x', 'хост оканчивается хостом Google'],
  ['https://tracker.example/lh3.googleusercontent.com/a.png', 'хост Google внутри пути'],
  ['https://avatars.yandex.net/get-music-content/1/a.png', 'хост Яндекса, не аватар входа'],
  ['https://res.cloudinary.com/demo/image/upload/v1/a.jpg', 'чужой аккаунт Cloudinary'],
  ['https://res.cloudinary.com/davrzdre8x/image/upload/v1/a.jpg', 'аккаунт, чьё имя начинается с нашего'],
  ['https://res.cloudinary.com/davrzdre8/image/fetch/https://tracker.example/x.png', 'наше облако, но доставка чужого файла (fetch)'],
  ['https://res.cloudinary.com/davrzdre8/image/upload/v1/avatars/user-1/photo.svg', 'svg из нашего облака: next/image пустил бы его мимо оптимизатора'],
  ['https://tracker.example@lh3.googleusercontent.com/a/x', 'логин в адресе'],
  ['https://:secret@lh3.googleusercontent.com/a/x', 'пароль в адресе без логина'],
  ['https://lh3.googleusercontent.com:8443/a/x', 'порт в адресе'],
  ['/uploads/avatars/0a1b2c3d.jpg', 'старый локальный путь (один такой на проде)'],
  ['//lh3.googleusercontent.com/a/x', 'адрес без схемы'],
  ['не адрес', 'мусор'],
];

// Оба списка оптимизатора, как в /_next/image (image-remote-patterns.test.ts).
const optimizerAdmits = (url: string) =>
  hasRemoteMatch(
    nextConfig.images?.domains ?? [],
    nextConfig.images?.remotePatterns ?? [],
    new URL(url),
  );

describe('avatarSource — откуда грузится аватар автора отзыва', () => {
  it('фото входа через Google и Яндекс — напрямую', () => {
    expect(avatarSource(GOOGLE)).toEqual({ src: GOOGLE });
    expect(avatarSource(YANDEX)).toEqual({ src: YANDEX });
  });

  // 09.11.2026: копия оптимизатора пережила удаление учётной записи (облако —
  // 404, сайт — 200). Фото человека сайт не копирует: ссылка из базы как есть.
  it('фото из нашего облака — тоже напрямую, ссылкой из базы как есть', () => {
    expect(avatarSource(OUR_CLOUD)).toEqual({ src: OUR_CLOUD });
  });

  it('грузится тот адрес, что проверен, — в разобранном виде', () => {
    expect(avatarSource('https://LH3.GoogleUserContent.com/a/x')).toEqual({
      src: 'https://lh3.googleusercontent.com/a/x',
    });
    // И из нашего облака — у него своя ветка возврата.
    expect(
      avatarSource(
        'https://RES.Cloudinary.com/davrzdre8/image/upload/v1/avatars/user-1/photo.jpg',
      ),
    ).toEqual({
      src: 'https://res.cloudinary.com/davrzdre8/image/upload/v1/avatars/user-1/photo.jpg',
    });
  });

  it('нет фото — нечего грузить', () => {
    expect(avatarSource(null)).toBeNull();
    expect(avatarSource(undefined)).toBeNull();
    expect(avatarSource('')).toBeNull();
  });

  it.each(REFUSED)('не грузится: %s (%s)', (url) => {
    expect(avatarSource(url)).toBeNull();
  });

  it('напрямую — только два хоста входа', () => {
    expect(SIGN_IN_AVATAR_SOURCES).toEqual([
      { hostname: 'lh3.googleusercontent.com', pathPrefix: '/' },
      { hostname: 'avatars.yandex.net', pathPrefix: '/get-yapic/' },
    ]);
  });

  // Сторож на образцах фото людей: ни один не возьмёт и прямой адрес
  // /_next/image?url=…, иначе копия фото человека снова ляжет в кэш сайта.
  // Правило пускает и другие пути нашего облака (папку карточек оптимизатор
  // берёт) — что сайт сам не ведёт аватар через оптимизатор, держит
  // `unoptimized` в ReviewAvatar (review-card.test.tsx).
  it('образцы фото людей, которые правило пускает, оптимизатор не принимает', () => {
    let loaded = 0;
    for (const url of [GOOGLE, YANDEX, OUR_CLOUD, ...REFUSED.map(([u]) => u)]) {
      const source = avatarSource(url);
      if (source) {
        loaded += 1;
        expect([url, optimizerAdmits(source.src)]).toEqual([url, false]);
      }
    }
    // Якорь: перебор не пуст — грузятся ровно три адреса.
    expect(loaded).toBe(3);
  });
});
