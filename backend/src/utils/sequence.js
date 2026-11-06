/**
 * Steps that run one after another, and that a request waits for only so long.
 *
 * Each step starts when the one before it is done, from the moment it is added,
 * so a step already added goes on whatever becomes of the request that added it.
 * The request waits for them with settleWithin, under one ceiling for the lot:
 * past it the request answers, and the steps left go on in the background.
 */

import logger from './logger.js';

/**
 * @returns {{
 *   add: (step: () => Promise<any>) => void,
 *   settleWithin: (ms: number) => Promise<{ settled: boolean, total: number, finished: number }>,
 * }} `add` queues a step; a step should handle its own failure, one it leaves is
 * logged and the next step still runs. `settleWithin` resolves when every step
 * added so far is done, or at the ceiling: `settled` tells which.
 */
export const startSequence = () => {
  let tail = Promise.resolve();
  let total = 0;
  let finished = 0;

  return {
    add(step) {
      total += 1;
      tail = tail
        .then(step)
        .catch((error) => {
          logger.error('A step of a sequence failed', { error: error.message });
        })
        .then(() => {
          finished += 1;
        });
    },

    async settleWithin(ms) {
      let timer;
      const ceiling = new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      });
      const settled = await Promise.race([tail.then(() => true), ceiling]);
      clearTimeout(timer);
      return { settled, total, finished };
    },
  };
};
