/**
 * @jest-environment node
 *
 * Откуда сайт берёт аватар автора отзыва (lib/avatar-source). Браузер гостя
 * обращается к серверу, с которого идёт фото, — поэтому напрямую грузятся
 * только фото входа через Google и Яндекс, наше облако идёт через оптимизатор
 * (как раньше), любой другой адрес не грузится вовсе: на карточке буква.
 *
 * Список хостов входа закреплён литералом: добавить хост — продуктовое
 * решение (чьи серверы видят адреса гостей), а не правка ради зелёного
 * прогона. Согласие с next.config.ts проверяется настоящим сопоставителем
 * Next (hasRemoteMatch), тем же, что решает в /_next/image.
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

const optimizerAdmits = (url: string) =>
  hasRemoteMatch([], nextConfig.images?.remotePatterns ?? [], new URL(url));

describe('avatarSource — откуда грузится аватар автора отзыва', () => {
  it('фото входа через Google и Яндекс — напрямую', () => {
    expect(avatarSource(GOOGLE)).toEqual({ src: GOOGLE, optimized: false });
    expect(avatarSource(YANDEX)).toEqual({ src: YANDEX, optimized: false });
  });

  it('фото из нашего облака — через оптимизатор, как раньше', () => {
    expect(avatarSource(OUR_CLOUD)).toEqual({ src: OUR_CLOUD, optimized: true });
  });

  it('грузится тот адрес, что проверен, — в разобранном виде', () => {
    expect(avatarSource('https://LH3.GoogleUserContent.com/a/x')).toEqual({
      src: 'https://lh3.googleusercontent.com/a/x',
      optimized: false,
    });
    // И из нашего облака — у него своя ветка возврата.
    expect(
      avatarSource(
        'https://RES.Cloudinary.com/davrzdre8/image/upload/v1/avatars/user-1/photo.jpg',
      ),
    ).toEqual({
      src: 'https://res.cloudinary.com/davrzdre8/image/upload/v1/avatars/user-1/photo.jpg',
      optimized: true,
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

  it('всё, что правило шлёт в оптимизатор, оптимизатор принимает; фото входа он не принимает', () => {
    let sentToOptimizer = 0;
    for (const url of [GOOGLE, YANDEX, OUR_CLOUD, ...REFUSED.map(([u]) => u)]) {
      const source = avatarSource(url);
      if (source?.optimized) {
        sentToOptimizer += 1;
        expect([url, optimizerAdmits(source.src)]).toEqual([url, true]);
      }
    }
    // Якорь: перебор не пуст — в оптимизатор идёт ровно наше облако.
    expect(sentToOptimizer).toBe(1);
    // Если однажды расширят remotePatterns на хосты входа — этот тест
    // покраснеет: P0 30.09.2026 сузил оптимизатор до нашего облака.
    expect(optimizerAdmits(GOOGLE)).toBe(false);
    expect(optimizerAdmits(YANDEX)).toBe(false);
  });
});
