/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Перезапуск распознавания читает заново только файлы меню, ни разу не
 * распознанные (решение Координатора 23.11.2026, Н8, вариант «Б»): новое
 * прочтение файла заменяет его блюда, а с ними и правки партнёра.
 *
 * Распознан ли файл, сервис узнаёт дважды: списком карточки и ещё раз прямо
 * перед постановкой файла, — сначала «идёт ли чтение», потом «есть ли
 * готовое». Первое чтение, которое закончилось между списком и очередью
 * файла, иначе поставило бы файл снова, и свежие блюда (с правками, если
 * партнёр успел) заменило бы новое прочтение. Такой очерёдности настоящая
 * база по команде не даст: модели подменены, сервис исполняется целиком.
 * Остальное поведение перезапуска держат integration/partner-menu-items и
 * integration/daily-ocr-allowance.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../models/menuItemModel.js', () => ({
  findById: jest.fn(),
  updateByIds: jest.fn(),
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
  findActiveJob: jest.fn(),
  hasCompletedJobForMedia: jest.fn(),
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

const EstablishmentModel = await import('../../models/establishmentModel.js');
const MediaModel = await import('../../models/mediaModel.js');
const OcrJobModel = await import('../../models/ocrJobModel.js');
const { enqueueWithinDailyAllowance } = await import('../../services/ocrAllowance.js');
const { retryOcr } = await import('../../services/partnerMenuItemService.js');

const PARTNER = '11111111-1111-4111-8111-111111111111';
const CARD = '22222222-2222-4222-8222-222222222222';
const NOTHING_TO_RECOGNIZE_TEXT =
  'Все файлы меню уже распознаны. Чтобы распознать файл заново, удалите его и загрузите ещё раз.';

/** Файлы карточки; ни один не распознан по списку, прочитанному первым. */
const cardFiles = (...ids) => {
  MediaModel.getOcrEligibleMedia.mockResolvedValue(ids.map((id) => ({ id })));
  OcrJobModel.getMediaIdsWithCompletedJob.mockResolvedValue(new Set());
};

/**
 * Состояние файлов на момент вопроса о каждом. `endsAfterFirstQuestion` —
 * файлы, чьё первое чтение идёт, пока о файле не спросили, и закончилось
 * «готово» сразу после первого вопроса, каким бы он ни был.
 */
const filesNow = ({ reading = [], done = [], endsAfterFirstQuestion = [] }) => {
  const asked = new Set();
  const stateOf = (id) => {
    if (endsAfterFirstQuestion.includes(id)) {
      const state = asked.has(id) ? 'done' : 'processing';
      asked.add(id);
      return state;
    }
    if (reading.includes(id)) return 'processing';
    if (done.includes(id)) return 'done';
    return 'failed';
  };
  OcrJobModel.findActiveJob.mockImplementation(async (id) => (
    stateOf(id) === 'processing' ? { id: `job-of-${id}`, status: 'processing' } : null
  ));
  OcrJobModel.hasCompletedJobForMedia.mockImplementation(async (id) => stateOf(id) === 'done');
};

beforeEach(() => {
  jest.clearAllMocks();
  OcrJobModel.findActiveJob.mockReset();
  OcrJobModel.hasCompletedJobForMedia.mockReset();
  enqueueWithinDailyAllowance.mockReset();
  EstablishmentModel.checkOwnership.mockResolvedValue(true);
  enqueueWithinDailyAllowance.mockResolvedValue({ queued: true, job: { id: 'new-job' } });
});

test('первое чтение закончилось, пока шёл перезапуск, — файл не ставится снова; другого нет — 409 «нечего распознавать»', async () => {
  cardFiles('menu-a');
  filesNow({ done: ['menu-a'] });

  await expect(retryOcr(PARTNER, CARD)).rejects.toMatchObject({
    statusCode: 409,
    code: 'NOTHING_TO_RECOGNIZE',
    message: NOTHING_TO_RECOGNIZE_TEXT,
  });
  expect(enqueueWithinDailyAllowance).not.toHaveBeenCalled();
});

test('чтение закончилось ровно между двумя вопросами о файле — файл не ставится снова: первым спрошено «идёт ли»', async () => {
  cardFiles('menu-a');
  filesNow({ endsAfterFirstQuestion: ['menu-a'] });

  await expect(retryOcr(PARTNER, CARD)).resolves.toEqual({ enqueuedJobs: 1, totalPdfs: 1 });
  expect(enqueueWithinDailyAllowance).not.toHaveBeenCalled();
});

test('один файл распознан к своей очереди, другой не распознан — ставится только второй, «1 из 2»', async () => {
  cardFiles('menu-a', 'menu-b');
  filesNow({ done: ['menu-a'] });

  await expect(retryOcr(PARTNER, CARD)).resolves.toEqual({ enqueuedJobs: 1, totalPdfs: 2 });
  expect(enqueueWithinDailyAllowance).toHaveBeenCalledTimes(1);
  expect(enqueueWithinDailyAllowance).toHaveBeenCalledWith({ userId: PARTNER, establishmentId: CARD, mediaId: 'menu-b' });
});

test('один файл распознан к своей очереди, у другого постановка упала — сбой сервера 500, не «нечего распознавать»', async () => {
  cardFiles('menu-a', 'menu-b');
  filesNow({ done: ['menu-a'] });
  enqueueWithinDailyAllowance.mockRejectedValue(new Error('connection terminated unexpectedly'));

  await expect(retryOcr(PARTNER, CARD)).rejects.toMatchObject({
    statusCode: 500,
    code: 'OCR_RESTART_FAILED',
  });
});
