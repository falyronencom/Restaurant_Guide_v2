/**
 * Partner wizard form ↔ payload builders (Phase C Slice 1, Segment B).
 *   toCreatePayload — the toJson analog (city-center assist, address join, canon).
 *   toUpdatePayload — includes menu PDF urls in menu_photos (data-loss guard).
 *   fromDetail      — edit / copy-from-previous hydration.
 */
import type { PartnerEstablishmentDetail } from '@/lib/api/types';
import {
  emptyForm,
  fromDetail,
  toCreatePayload,
  toUpdatePayload,
  type WizardFormState,
} from '@/lib/partner/form';

describe('toCreatePayload', () => {
  it('substitutes the city-center coordinates when lat/lng are unset (Decision 5)', () => {
    const f: WizardFormState = {
      ...emptyForm(),
      name: 'Кафе',
      city: 'Гомель',
      street: 'ул. Советская',
      building: '5',
      categories: ['Кафе'],
      cuisines: ['Народная'],
    };
    const p = toCreatePayload(f);
    expect(p.latitude).toBeCloseTo(52.42);
    expect(p.longitude).toBeCloseTo(31.0);
    expect(p.address).toBe('ул. Советская, 5');
  });

  it('keeps explicit coordinates and omits empty optionals', () => {
    const f: WizardFormState = {
      ...emptyForm(),
      name: 'Бар',
      city: 'Минск',
      street: 'пр. Независимости',
      categories: ['Бар'],
      cuisines: ['Авторская'],
      latitude: 53.9,
      longitude: 27.56,
      attributes: ['wifi', 'parking'],
      workingHours: {
        ...emptyForm().workingHours,
        friday: { isOpen: true, open: '12:00', close: '00:00' },
      },
    };
    const p = toCreatePayload(f);
    expect(p.latitude).toBe(53.9);
    expect(p.longitude).toBe(27.56);
    expect(p.attributes).toEqual({ wifi: true, parking: true });
    expect(p.working_hours.friday).toEqual({
      is_open: true,
      open: '12:00',
      close: '00:00',
    });
    expect(p.working_hours.monday).toEqual({ is_open: false });
    expect('description' in p).toBe(false);
    expect('phone' in p).toBe(false);
  });

  it('carries media separated into interior/menu/pdf', () => {
    const f: WizardFormState = {
      ...emptyForm(),
      name: 'Кафе',
      city: 'Минск',
      street: 'ул. 1',
      categories: ['Кафе'],
      cuisines: ['Народная'],
      interiorPhotos: [{ url: 'i1.jpg' }],
      menuPhotos: [{ url: 'm1.jpg' }],
      menuPdfs: [
        { url: 'menu.pdf', thumbnail_url: 't', preview_url: 'p', file_name: 'menu.pdf' },
      ],
      primaryPhotoUrl: 'i1.jpg',
    };
    const p = toCreatePayload(f);
    expect(p.interior_photos).toEqual(['i1.jpg']);
    expect(p.menu_photos).toEqual(['m1.jpg']);
    expect(p.menu_pdfs).toHaveLength(1);
    expect(p.primary_photo).toBe('i1.jpg');
  });
});

describe('toUpdatePayload', () => {
  it('includes menu PDF urls in menu_photos so the PUT sync does not delete them', () => {
    const f: WizardFormState = {
      ...emptyForm(),
      name: 'Кафе',
      city: 'Минск',
      street: 'ул. 1',
      categories: ['Кафе'],
      cuisines: ['Народная'],
      menuPhotos: [{ url: 'm1.jpg' }],
      menuPdfs: [
        { url: 'menu.pdf', thumbnail_url: 't', preview_url: 'p', file_name: 'menu.pdf' },
      ],
    };
    const u = toUpdatePayload(f);
    expect(u.menu_photos).toEqual(['m1.jpg', 'menu.pdf']);
    // PUT does not process menu_pdfs (asymmetry Q1).
    expect('menu_pdfs' in u).toBe(false);
    // Image arrays are always present (even empty) for delete-missing sync.
    expect(Array.isArray(u.interior_photos)).toBe(true);
  });
});

function detail(
  over: Partial<PartnerEstablishmentDetail>,
): PartnerEstablishmentDetail {
  return {
    name: 'Кафе «Эталон»',
    description: 'Описание',
    city: 'Минск',
    address: 'ул. Ленина, 5',
    latitude: 53.9,
    longitude: 27.56,
    phone: '+375291234567',
    email: 'a@b.by',
    website: 'b.by',
    categories: ['Кафе'],
    cuisines: ['Народная'],
    price_range: '$$',
    attributes: { wifi: true, banquets: true, kids: true, parking: false },
    interior_photos: ['i1.jpg'],
    menu_photos: ['m1.jpg', 'menu.pdf'],
    primary_photo: { url: 'i1.jpg', thumbnail_url: null },
    working_hours: {
      monday: { is_open: true, open: '09:00', close: '18:00' },
      tuesday: { is_open: false },
    },
    ...over,
  } as unknown as PartnerEstablishmentDetail;
}

describe('fromDetail (edit / copy hydration)', () => {
  it('maps scalars, splits media by the .pdf heuristic, and folds address into street', () => {
    const f = fromDetail(detail({}));
    expect(f.name).toBe('Кафе «Эталон»');
    expect(f.priceRange).toBe('$$');
    expect(f.city).toBe('Минск');
    expect(f.street).toBe('ул. Ленина, 5');
    expect(f.building).toBe('');
    expect(f.interiorPhotos).toEqual([{ url: 'i1.jpg' }]);
    expect(f.menuPhotos).toEqual([{ url: 'm1.jpg' }]);
    expect(f.menuPdfs).toHaveLength(1);
    expect(f.menuPdfs[0]).toMatchObject({ url: 'menu.pdf', file_name: 'menu.pdf' });
    expect(f.primaryPhotoUrl).toBe('i1.jpg');
  });

  it('filters attributes to the canon (drops legacy non-canon writer keys and false values)', () => {
    const f = fromDetail(detail({}));
    // wifi is canon+true → kept; banquets/kids are non-canon → dropped; parking canon but false → dropped.
    expect(f.attributes).toEqual(['wifi']);
  });

  it('normalizes canonical per-day working hours', () => {
    const f = fromDetail(detail({}));
    expect(f.workingHours.monday).toEqual({
      isOpen: true,
      open: '09:00',
      close: '18:00',
    });
    expect(f.workingHours.tuesday.isOpen).toBe(false);
  });

  it('parses legacy string working hours', () => {
    const f = fromDetail(detail({ working_hours: { monday: '10:00-22:00' } }));
    expect(f.workingHours.monday).toEqual({
      isOpen: true,
      open: '10:00',
      close: '22:00',
    });
  });
});
