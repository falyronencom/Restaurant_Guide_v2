/**
 * Partner wizard gate logic (Phase C Slice 1, Segment B) — pure functions.
 *   meetsValidatorMinimum: the two-stage draft threshold (server-draft creation).
 *   evaluateE1: the sticky-sidebar checklist gating Submit.
 *   clientCompleteness: the base_score mirror driving the completeness bar.
 */
import { clientCompleteness } from '@/lib/partner/completeness';
import { CUISINE_OPTIONAL_CATEGORIES, isCuisineRequired } from '@/lib/partner/constants';
import { emptyForm, type WizardFormState } from '@/lib/partner/form';
import { evaluateE1, meetsValidatorMinimum } from '@/lib/partner/validation';

function photo(i: number) {
  return { url: `https://cdn.example/p${i}.jpg` };
}

function withMondayOpen(f: WizardFormState): WizardFormState {
  return {
    ...f,
    workingHours: {
      ...f.workingHours,
      monday: { isOpen: true, open: '10:00', close: '22:00' },
    },
  };
}

describe('meetsValidatorMinimum', () => {
  /*
   * Honesty audit (2026-09-07/08, closed 2026-10-25): every conjunct is now
   * the SOLE reason some fixture is false — the «all but one» table below
   * (name, city, address, category; cuisine — in the bar/club block at the
   * end) and the hours case. Dropping any one of them from validation.ts
   * turns its row red. The `street || building` rule is held by the
   * street-only case. In evaluateE1 below the same holds for photos (4 vs 5),
   * menu, hours and both halves of classification.
   */
  const complete = withMondayOpen({
    ...emptyForm(),
    name: 'Кафе «Весна»',
    city: 'Минск',
    street: 'проспект Независимости',
    building: '10',
    categories: ['Кафе'],
    cuisines: ['Народная'],
  });

  it.each<[string, Partial<WizardFormState>]>([
    ['name', { name: '' }],
    ['city', { city: '' }],
    ['address (neither street nor building)', { street: '', building: '' }],
    ['category (cuisine present)', { categories: [] }],
  ])('is false when everything but the %s is filled', (_, missing) => {
    expect(meetsValidatorMinimum(complete)).toBe(true); // fixture guard
    expect(meetsValidatorMinimum({ ...complete, ...missing })).toBe(false);
  });

  it('is false for an empty form', () => {
    expect(meetsValidatorMinimum(emptyForm())).toBe(false);
  });

  it('is true with name + city + address + ≥1 cat + ≥1 cuisine + observed hours (lat/lng NOT required)', () => {
    const f = withMondayOpen({
      ...emptyForm(),
      name: 'Кафе «Весна»',
      city: 'Минск',
      street: 'проспект Независимости',
      building: '10',
      categories: ['Кафе'],
      cuisines: ['Народная'],
    });
    expect(f.latitude).toBeNull();
    expect(meetsValidatorMinimum(f)).toBe(true);
  });

  it('accepts an address with a street and no building — the rule is street OR building', () => {
    // M34 (`||` → `&&`) survived every fixture above: the true-case supplied
    // BOTH parts, the false-cases failed on some other conjunct. A partner who
    // typed only the street would silently stop getting a server draft.
    const f = withMondayOpen({
      ...emptyForm(),
      name: 'Кафе «Весна»',
      city: 'Минск',
      street: 'проспект Независимости',
      categories: ['Кафе'],
      cuisines: ['Народная'],
    });
    expect(f.building).toBe('');
    expect(meetsValidatorMinimum(f)).toBe(true);
  });

  it('is false without observed hours (no silent defaults — Q10)', () => {
    const f = {
      ...emptyForm(),
      name: 'Кафе',
      city: 'Минск',
      street: 'ул. 1',
      categories: ['Кафе'],
      cuisines: ['Народная'],
    };
    expect(meetsValidatorMinimum(f)).toBe(false);
  });
});

describe('evaluateE1', () => {
  const ready = withMondayOpen({
    ...emptyForm(),
    categories: ['Кафе'],
    cuisines: ['Народная'],
    description: 'о'.repeat(120),
    interiorPhotos: [photo(1), photo(2), photo(3), photo(4), photo(5)],
    menuPhotos: [photo(6)],
  });

  it('passes when the gating checks hold (description reported alongside)', () => {
    expect(evaluateE1(ready)).toMatchObject({
      photos: true,
      menu: true,
      classification: true,
      description: true,
      hours: true,
      passed: true,
    });
  });

  it('fails photos (and overall) with fewer than 5 interior photos', () => {
    const f = { ...ready, interiorPhotos: [photo(1), photo(2)] };
    const e1 = evaluateE1(f);
    expect(e1.photos).toBe(false);
    expect(e1.passed).toBe(false);
    // The boundary itself: 4 is not enough, 5 is (product rule «от 5 фото»;
    // the server does not check media, so this gate is the only one).
    const four = evaluateE1({
      ...ready,
      interiorPhotos: [photo(1), photo(2), photo(3), photo(4)],
    });
    expect(four.photos).toBe(false);
    expect(four.passed).toBe(false);
    expect(ready.interiorPhotos).toHaveLength(5);
    expect(evaluateE1(ready).photos).toBe(true);
  });

  // Classification has two halves: a category, and a cuisine where the
  // category needs one. The cuisine half is held by the bar/club block at the
  // end; this is the category half — the cuisine is there, the category not.
  it('fails classification (and overall) without a category — cuisine present', () => {
    expect(ready.cuisines.length).toBeGreaterThan(0); // fixture guard
    const e1 = evaluateE1({ ...ready, categories: [] });
    expect(e1.classification).toBe(false);
    expect(e1.passed).toBe(false);
  });

  it('fails hours (and overall) when no day is open — everything else ready', () => {
    const e1 = evaluateE1({ ...ready, workingHours: emptyForm().workingHours });
    expect(e1).toMatchObject({
      photos: true,
      menu: true,
      classification: true,
      hours: false,
      passed: false,
    });
  });

  it('menu is satisfied by a PDF alone', () => {
    const f = {
      ...ready,
      menuPhotos: [],
      menuPdfs: [
        { url: 'm.pdf', thumbnail_url: '', preview_url: '', file_name: 'm.pdf' },
      ],
    };
    expect(evaluateE1(f).menu).toBe(true);
  });

  it('reports a short description as unmet but still passes (CAT-E-2.3 Amendment)', () => {
    const e1 = evaluateE1({ ...ready, description: 'коротко' });
    expect(e1.description).toBe(false);
    expect(e1.passed).toBe(true);
  });

  it('passes with NO description — it is a pre-flip requirement, not a submit gate', () => {
    const e1 = evaluateE1({ ...ready, description: '' });
    expect(e1.description).toBe(false);
    expect(e1.passed).toBe(true);
  });

  it('still fails when a genuinely gating item is missing', () => {
    expect(evaluateE1({ ...ready, description: '', menuPhotos: [] }).passed).toBe(
      false,
    );
  });
});

describe('clientCompleteness mirrors the base_score weights', () => {
  it('is 0 for an empty form', () => {
    expect(clientCompleteness(emptyForm())).toBe(0);
  });

  it('is 100 with all weighted fields present (25+25+20+15+10+5)', () => {
    const f: WizardFormState = {
      ...emptyForm(),
      description: 'Уютное место',
      priceRange: '$$',
      attributes: ['wifi'],
      phone: '+375291234567',
      email: 'info@example.by',
      website: 'example.by',
    };
    expect(clientCompleteness(f)).toBe(100);
  });

  it('sums only the present fields (description + phone = 40)', () => {
    const f = { ...emptyForm(), description: 'x', phone: '+375291112233' };
    expect(clientCompleteness(f)).toBe(40);
    // Honesty audit 2026-09-07: the total alone cannot see a permutation of the
    // weights — swapping priceRange (25) with attributes (20) left every test
    // green. Each weight this file claims to mirror is now pinned on its own.
    // description and phone too: their sum (40) and the total (100) cannot
    // see the two swapped. Weights from the server's base_score
    // (establishmentModel.calculateCompletenessScore): description 25,
    // price 25, attributes 20, phone 15, email 10, website 5.
    expect(clientCompleteness({ ...emptyForm(), description: 'x' })).toBe(25);
    expect(clientCompleteness({ ...emptyForm(), phone: '+375291112233' })).toBe(15);
    expect(clientCompleteness({ ...emptyForm(), priceRange: '$$' })).toBe(25);
    expect(clientCompleteness({ ...emptyForm(), attributes: ['wifi'] })).toBe(20);
    expect(clientCompleteness({ ...emptyForm(), email: 'info@example.by' })).toBe(10);
    expect(clientCompleteness({ ...emptyForm(), website: 'example.by' })).toBe(5);
  });
});

// Решение Координатора В5 (17.10.2026): кухня необязательна для бара и клуба;
// сверка находок тестировщика с сайтом, 18.10, пункт 34. Пока кухня у бара была
// обязательна, серверный черновик бара без кухни не создавался вовсе, а
// «Отправить на модерацию» не включалась.
describe('кухня у бара и клуба — по желанию', () => {
  const minimum = (categories: string[], cuisines: string[]) =>
    withMondayOpen({
      ...emptyForm(),
      name: 'Заведение',
      city: 'Минск',
      street: 'ул. 1',
      categories,
      cuisines,
    });

  const ready = (categories: string[], cuisines: string[]) => ({
    ...minimum(categories, cuisines),
    interiorPhotos: [photo(1), photo(2), photo(3), photo(4), photo(5)],
    menuPhotos: [photo(6)],
  });

  it.each([
    [['Бар']],
    [['Клуб']],
    [['Бар', 'Клуб']],
    // Ш17 (19.10.2026)
    [['Кальянная']],
    [['Боулинг']],
    [['Караоке']],
    [['Бильярд']],
  ])(
    '%j без кухни: черновик создаётся, классификация засчитана, отправка открыта',
    (categories) => {
      expect(meetsValidatorMinimum(minimum(categories, []))).toBe(true);
      const e1 = evaluateE1(ready(categories, []));
      expect(e1.classification).toBe(true);
      expect(e1.passed).toBe(true);
    },
  );

  it.each([
    [['Ресторан']],
    [['Бар', 'Ресторан']],
    [['Клуб', 'Кафе']],
    [['Паб']],
    [['Боулинг', 'Паб']],
  ])(
    '%j без кухни: черновика нет, классификация не засчитана — кухня обязательна',
    (categories) => {
      expect(meetsValidatorMinimum(minimum(categories, []))).toBe(false);
      const e1 = evaluateE1(ready(categories, []));
      expect(e1.classification).toBe(false);
      expect(e1.passed).toBe(false);
    },
  );

  it('без категории кухня обязательна (строже)', () => {
    expect(isCuisineRequired([])).toBe(true);
  });

  it('совпадает с сервером: бар, клуб, кальянная, боулинг, караоке, бильярд', () => {
    expect([...CUISINE_OPTIONAL_CATEGORIES].sort()).toEqual(
      ['Бар', 'Бильярд', 'Боулинг', 'Караоке', 'Кальянная', 'Клуб'].sort(),
    );
  });
});
