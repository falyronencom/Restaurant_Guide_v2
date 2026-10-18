/**
 * «Возобновить показ» идёт в свой обработчик (сверка находок тестировщика с
 * сайтом, 18.10, пункт С3): POST /api/partner/establishments/:id/resume —
 * не submit (тот отправил бы карточку на модерацию).
 */
import { resumeEstablishmentAction } from '@/lib/partner/client';

const realFetch = global.fetch;
afterAll(() => {
  global.fetch = realFetch;
});

it('POSTs to the resume handler and returns its envelope', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    json: () => Promise.resolve({ ok: true, status: 'active' }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  await expect(resumeEstablishmentAction('e 1')).resolves.toEqual({ ok: true, status: 'active' });
  expect(fetchMock).toHaveBeenCalledWith('/api/partner/establishments/e%201/resume', {
    method: 'POST',
  });
});
