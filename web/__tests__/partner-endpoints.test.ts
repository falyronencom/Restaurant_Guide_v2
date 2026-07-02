/**
 * Partner endpoint wire-envelope pin (cabinet create/edit hotfix).
 *
 * The backend controller wraps single-entity responses as
 * `data: { establishment: {…} }` (create / get / update / submit), while the
 * list returns `data: { establishments, pagination }` directly. The web
 * wrappers previously cast `data` AS the entity — so `.id` / `.name` were
 * undefined: the wizard never stored its draftId (every autosave re-CREATEd →
 * DUPLICATE_ESTABLISHMENT) and the edit form seeded empty. Operations-layer
 * tests mock this very boundary and could not catch it; this suite pins the
 * unwrapping against the REAL envelope shape.
 */
jest.mock('@/lib/auth/session', () => ({
  authedFetch: jest.fn(),
}));

import { authedFetch } from '@/lib/auth/session';
import {
  createEstablishment,
  getEstablishment,
  listEstablishments,
  submitEstablishment,
  updateEstablishment,
} from '@/lib/api/endpoints/partner';

const fetchMock = authedFetch as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('partner endpoints — data.establishment unwrapping', () => {
  it('createEstablishment unwraps { establishment } and hits POST base', async () => {
    fetchMock.mockResolvedValue({
      establishment: { id: 'e1', status: 'draft', base_score: 25 },
    });

    const r = await createEstablishment({ name: 'Кафе' } as never);

    expect(r).toEqual({ id: 'e1', status: 'draft', base_score: 25 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/partner/establishments',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('getEstablishment unwraps the detail', async () => {
    fetchMock.mockResolvedValue({
      establishment: { id: 'e1', name: 'Кафе', status: 'draft' },
    });

    const r = await getEstablishment('e1');

    expect(r).toMatchObject({ id: 'e1', name: 'Кафе' });
  });

  it('updateEstablishment unwraps and PUTs to /:id', async () => {
    fetchMock.mockResolvedValue({
      establishment: { status: 'draft', base_score: 60 },
    });

    const r = await updateEstablishment('e1', {});

    expect(r).toEqual({ status: 'draft', base_score: 60 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/partner/establishments/e1',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('submitEstablishment unwraps and POSTs to /:id/submit', async () => {
    fetchMock.mockResolvedValue({
      establishment: { id: 'e1', status: 'pending' },
    });

    const r = await submitEstablishment('e1');

    expect(r).toMatchObject({ status: 'pending' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/partner/establishments/e1/submit',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('listEstablishments returns data directly (NOT wrapped in establishment)', async () => {
    const data = { establishments: [], pagination: { total: 0 } };
    fetchMock.mockResolvedValue(data);

    await expect(listEstablishments()).resolves.toBe(data);
  });
});
