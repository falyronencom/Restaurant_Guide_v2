/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * The answer to a partner's edit of a menu line carries what the guest is not
 * shown it for (brief of 05.11.2026). Two things a real database cannot be made
 * to do on cue, so the models are stubbed and the service runs whole: the read
 * of the mark fails after the edit stood, and an edit brings a line back into
 * the guest's view, which only the log keeps.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../models/menuItemModel.js', () => ({
  findById: jest.fn(),
  updateById: jest.fn(),
  getByEstablishmentId: jest.fn(),
  hasHiddenByEstablishment: jest.fn(),
}));
jest.unstable_mockModule('../../models/establishmentModel.js', () => ({
  checkOwnership: jest.fn(),
}));
jest.unstable_mockModule('../../models/mediaModel.js', () => ({
  getOcrEligibleMedia: jest.fn(),
}));
jest.unstable_mockModule('../../models/ocrJobModel.js', () => ({
  getLatestJobPerMenuFile: jest.fn(),
  getMediaIdsWithCompletedJob: jest.fn(),
}));
jest.unstable_mockModule('../../services/badgesService.js', () => ({
  invalidateCache: jest.fn(),
}));
jest.unstable_mockModule('../../services/qualityHealthService.js', () => ({
  invalidateCache: jest.fn(),
}));
jest.unstable_mockModule('../../services/ocrAllowance.js', () => ({
  DailyOcrLimitError: class DailyOcrLimitError extends Error {},
  enqueueWithinDailyAllowance: jest.fn(),
}));
jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const MenuItemModel = await import('../../models/menuItemModel.js');
const EstablishmentModel = await import('../../models/establishmentModel.js');
const logger = (await import('../../utils/logger.js')).default;
const { updateMenuItem } = await import('../../services/partnerMenuItemService.js');

const PARTNER = '11111111-1111-4111-8111-111111111111';
const CARD = '22222222-2222-4222-8222-222222222222';
const row = (categoryRaw) => ({
  id: 'item-1',
  establishment_id: CARD,
  media_id: 'media-1',
  item_name: 'Хаус',
  price_byn: '12.00',
  category_raw: categoryRaw,
  sanity_flag: null,
  is_hidden_by_admin: false,
  position: 0,
});

beforeEach(() => {
  jest.clearAllMocks();
  EstablishmentModel.checkOwnership.mockResolvedValue(true);
});

test('the read of the mark fails after the edit stood → the edit is answered as done, and the log says why', async () => {
  MenuItemModel.findById.mockResolvedValue(row('Вино'));
  MenuItemModel.getByEstablishmentId
    .mockResolvedValueOnce([row('Вино')])
    .mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
  MenuItemModel.updateById.mockResolvedValue(row('Закуски'));

  await expect(updateMenuItem(PARTNER, 'item-1', { category_raw: 'Закуски' })).resolves.toEqual(row('Закуски'));

  expect(logger.error).toHaveBeenCalledWith(
    'The mark of an edited menu item could not be read — answered without it',
    { menuItemId: 'item-1', establishmentId: CARD, error: 'connection terminated unexpectedly' },
  );
});

test('an edit that brings a line back into the guest\'s view is in the log, with what it was', async () => {
  MenuItemModel.findById.mockResolvedValue(row('Вино'));
  MenuItemModel.getByEstablishmentId
    .mockResolvedValueOnce([row('Вино')])
    .mockResolvedValueOnce([row('Закуски')]);
  MenuItemModel.updateById.mockResolvedValue(row('Закуски'));

  const answer = await updateMenuItem(PARTNER, 'item-1', { category_raw: 'Закуски' });

  expect(answer.guest_hidden_reason).toBeNull();
  expect(logger.warn).toHaveBeenCalledWith(
    'Partner edit brought a menu line back into the guest menu',
    {
      menuItemId: 'item-1',
      partnerId: PARTNER,
      establishmentId: CARD,
      reasonBefore: 'alcohol',
      before: { item_name: 'Хаус', category_raw: 'Вино' },
      after: { item_name: 'Хаус', category_raw: 'Закуски' },
    },
  );
});

test('an edit that leaves the line where it was is not in that log', async () => {
  MenuItemModel.findById.mockResolvedValue(row('Вино'));
  MenuItemModel.getByEstablishmentId
    .mockResolvedValueOnce([row('Вино')])
    .mockResolvedValueOnce([{ ...row('Вино'), price_byn: '13.00' }]);
  MenuItemModel.updateById.mockResolvedValue({ ...row('Вино'), price_byn: '13.00' });

  const answer = await updateMenuItem(PARTNER, 'item-1', { price_byn: 13 });

  expect(answer.guest_hidden_reason).toBe('alcohol');
  expect(logger.warn).not.toHaveBeenCalled();
});
