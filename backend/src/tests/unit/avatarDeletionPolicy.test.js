/* eslint-env jest */
/**
 * Когда петля удаления папок работает и как часто: config/avatarDeletion.js.
 *
 * Значения — литералы: прод включён без настройки, локальный сервер выключен
 * (у него настоящие ключи облака и может быть снимок прода в базе), сумма вызовов
 * укладывается в лимит плана.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import {
  CLAIM_LEASE_MS,
  RETRY_PAUSES_MS,
  TICK_INTERVAL_MS,
  resolveAvatarDeletionPolicy,
} from '../../config/avatarDeletion.js';
import * as avatarDeletionLoop from '../../services/avatarDeletionLoop.js';

describe('включена или нет', () => {
  test.each([
    ['прод без настройки', { NODE_ENV: 'production' }, true, 0],
    ['локально без настройки', { NODE_ENV: 'development' }, false, 0],
    ['в тестах без настройки', { NODE_ENV: 'test' }, false, 0],
    ['прод: выключена словом', { NODE_ENV: 'production', AVATAR_DELETION_ENABLED: 'false' }, false, 0],
    ['локально: включена словом', { NODE_ENV: 'development', AVATAR_DELETION_ENABLED: 'true' }, true, 0],
    ['пустая строка — как без настройки', { NODE_ENV: 'production', AVATAR_DELETION_ENABLED: ' ' }, true, 0],
    ['опечатка на проде: умолчание и предупреждение', { NODE_ENV: 'production', AVATAR_DELETION_ENABLED: 'no' }, true, 1],
    ['опечатка локально: умолчание и предупреждение', { NODE_ENV: 'development', AVATAR_DELETION_ENABLED: '1' }, false, 1],
  ])('%s', (_name, env, enabled, warnings) => {
    const policy = resolveAvatarDeletionPolicy(env);

    expect(policy.enabled).toBe(enabled);
    expect(policy.warnings).toHaveLength(warnings);
  });
});

describe('значения', () => {
  test('раз в минуту по одному человеку: три списка — не больше 180 вызовов в час из 500', () => {
    expect(TICK_INTERVAL_MS).toBe(60000);
    expect((3600000 / TICK_INTERVAL_MS) * 3).toBe(180);
    expect(resolveAvatarDeletionPolicy({}).intervalMs).toBe(60000);
  });

  test('девять попыток примерно за трое суток', () => {
    expect(RETRY_PAUSES_MS).toHaveLength(8);
    const hours = RETRY_PAUSES_MS.reduce((sum, pause) => sum + pause, 0) / 3600000;
    expect(Math.round(hours)).toBe(70);
  });

  test('задача возвращается позже, чем длится самая долгая обычная работа', () => {
    // Три списка и файлы папки, каждый вызов до 20 с: 10 минут хватает на 27 файлов
    // при облаке на грани срока; короче обещанного повторы безвредны, но лишни.
    expect(CLAIM_LEASE_MS).toBe(600000);
  });
});

describe('сервер петлю запускает и останавливает', () => {
  // server.js под NODE_ENV=test не стартует: связка проверяется по тексту, иначе её
  // снятие не видел бы никто, а задачи молча копились бы в таблице.
  const server = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server.js'), 'utf8');

  test('запуск при старте', () => {
    expect(server).toContain('const avatarDeletionPolicy = avatarDeletionLoop.start();');
  });

  test('остановка среди фоновых петель выключения', () => {
    const loops = server.slice(server.indexOf('backgroundLoops: ['), server.indexOf('closePool,'));
    expect(loops).toContain('stop: () => avatarDeletionLoop.stop(),');
  });
});

describe('запуск и остановка', () => {
  afterEach(async () => {
    await avatarDeletionLoop.stop();
  });

  test('выключенная не запускается и ничего не зовёт', () => {
    const interval = jest.spyOn(global, 'setInterval');

    const policy = avatarDeletionLoop.start({ env: { NODE_ENV: 'development' } });

    expect(policy.enabled).toBe(false);
    expect(avatarDeletionLoop.status()).toEqual({ running: false, working: false });
    expect(interval).not.toHaveBeenCalled();
  });

  test('stop без запуска — не ошибка', async () => {
    await expect(avatarDeletionLoop.stop()).resolves.toBeUndefined();
  });
});
