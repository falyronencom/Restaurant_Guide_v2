/* eslint-env jest */
/**
 * startSequence: шаги идут по очереди, запрос ждёт их с одним потолком на всех,
 * а за потолком шаги доходят сами. Тесты работают на промисах, которые отпускают
 * руками; настоящий подвисший Redis — integration/writes-before-answer.test.js.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const logger = (await import('../../utils/logger.js')).default;
const { startSequence } = await import('../../utils/sequence.js');

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Дать очереди дойти до следующего шага. */
const flush = () => new Promise((resolve) => { setImmediate(resolve); });

const FAR_CEILING_MS = 10000;
const NEAR_CEILING_MS = 20;

describe('startSequence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('следующий шаг начинается, когда закончился предыдущий, в порядке добавления', async () => {
    const sequence = startSequence();
    const first = deferred();
    const second = deferred();
    const started = [];
    sequence.add(() => { started.push('first'); return first.promise; });
    sequence.add(() => { started.push('second'); return second.promise; });

    await flush();
    expect(started).toEqual(['first']);

    first.resolve();
    await flush();
    expect(started).toEqual(['first', 'second']);

    second.resolve();
    await expect(sequence.settleWithin(FAR_CEILING_MS)).resolves.toEqual({ settled: true, total: 2, finished: 2 });
  });

  test('шаги начинаются сразу, не дожидаясь settleWithin', async () => {
    const sequence = startSequence();
    const step = jest.fn(() => Promise.resolve());
    sequence.add(step);

    await flush();

    expect(step).toHaveBeenCalledTimes(1);
  });

  test('settleWithin не возвращается, пока шаг не закончился и потолок не вышел', async () => {
    const sequence = startSequence();
    const step = deferred();
    sequence.add(() => step.promise);

    let returned = false;
    const waiting = sequence.settleWithin(FAR_CEILING_MS).then((result) => {
      returned = true;
      return result;
    });

    await flush();
    expect(returned).toBe(false);

    step.resolve();
    await expect(waiting).resolves.toEqual({ settled: true, total: 1, finished: 1 });
  });

  test('потолок один на всю очередь: за ним запрос свободен, а шаги доходят сами', async () => {
    const sequence = startSequence();
    const hung = deferred();
    const after = jest.fn(() => Promise.resolve());
    sequence.add(() => hung.promise);
    sequence.add(after);

    await expect(sequence.settleWithin(NEAR_CEILING_MS)).resolves.toEqual({ settled: false, total: 2, finished: 0 });
    expect(after).not.toHaveBeenCalled();

    hung.resolve();
    await flush();
    expect(after).toHaveBeenCalledTimes(1);
    await expect(sequence.settleWithin(FAR_CEILING_MS)).resolves.toEqual({ settled: true, total: 2, finished: 2 });
  });

  test('шаг, упавший без своего .catch, не останавливает следующие и не роняет процесс', async () => {
    const sequence = startSequence();
    const next = jest.fn(() => Promise.resolve());
    sequence.add(() => Promise.reject(new Error('queue refused')));
    sequence.add(() => { throw new Error('thrown at once'); });
    sequence.add(next);

    await expect(sequence.settleWithin(FAR_CEILING_MS)).resolves.toEqual({ settled: true, total: 3, finished: 3 });

    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('A step of a sequence failed', { error: 'queue refused' });
    expect(logger.error).toHaveBeenCalledWith('A step of a sequence failed', { error: 'thrown at once' });
  });

  test('пустая очередь: settleWithin возвращается сразу', async () => {
    await expect(startSequence().settleWithin(FAR_CEILING_MS)).resolves.toEqual({ settled: true, total: 0, finished: 0 });
  });
});
