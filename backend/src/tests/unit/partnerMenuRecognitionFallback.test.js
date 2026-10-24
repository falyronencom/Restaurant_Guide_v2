/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Состояние распознавания в ответе меню партнёра — вспомогательное поле:
 * сбой его запроса не роняет список позиций (ревью 24.10.2026, линза,
 * «Укрепление»). Ответ идёт с `recognition: null` — клиент читает это как
 * сервер без поля, то есть прежний экран; сбой пишется в журнал, не молча.
 *
 * Через настоящее приложение сбой второго запроса не вызвать: модели
 * подменены, сервис исполняется целиком.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../models/menuItemModel.js', () => ({
  getByEstablishmentId: jest.fn(),
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
const OcrJobModel = await import('../../models/ocrJobModel.js');
const logger = (await import('../../utils/logger.js')).default;
const { listMenuItems } = await import('../../services/partnerMenuItemService.js');

const PARTNER = '11111111-1111-4111-8111-111111111111';
const CARD = '22222222-2222-4222-8222-222222222222';
const ITEM = { id: 'item-1', item_name: 'Борщ' };

beforeEach(() => {
  EstablishmentModel.checkOwnership.mockResolvedValue(true);
  MenuItemModel.getByEstablishmentId.mockResolvedValue([ITEM]);
});

test('the state query fails → the items still come, recognition is null, and the log says why', async () => {
  OcrJobModel.getLatestJobPerMenuFile.mockRejectedValue(new Error('canceling statement due to statement timeout'));

  await expect(listMenuItems(PARTNER, CARD)).resolves.toEqual({ items: [ITEM], recognition: null });
  expect(logger.error).toHaveBeenCalledWith(
    'Recognition state of the partner menu could not be read — answered without it',
    { establishmentId: CARD, error: 'canceling statement due to statement timeout' },
  );
});

test('the state query answers → the state comes with the items', async () => {
  OcrJobModel.getLatestJobPerMenuFile.mockResolvedValue([
    { media_id: 'm-1', status: 'processing', error_message: null, completed_at: null, has_done_job: false },
  ]);

  await expect(listMenuItems(PARTNER, CARD)).resolves.toEqual({
    items: [ITEM],
    recognition: { status: 'processing' },
  });
  expect(logger.error).not.toHaveBeenCalled();
});

test('not the partner\'s card → refused before any state is read', async () => {
  EstablishmentModel.checkOwnership.mockResolvedValue(false);

  await expect(listMenuItems(PARTNER, CARD)).rejects.toMatchObject({ statusCode: 404, code: 'ESTABLISHMENT_NOT_FOUND' });
  expect(OcrJobModel.getLatestJobPerMenuFile).not.toHaveBeenCalled();
});
