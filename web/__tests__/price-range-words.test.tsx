/**
 * Average check in words — one source for the site (lib/price-range.ts): the
 * venue card, the filters and the partner wizard say «до 50 руб», not a bare
 * «$$» (Coordinator, 29.10.2026: the wizard showed bare tiers and the partner
 * had to guess). The tier the wizard saves stays «$$».
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { fireEvent, render, screen } from '@testing-library/react';

import { BasicInfoSection } from '@/components/cabinet/wizard/BasicInfoSection';
import { PRICE_OPTIONS } from '@/lib/facets';
import { emptyForm } from '@/lib/partner/form';
import { PRICE_RANGES } from '@/lib/partner/constants';
import { PRICE_DESCRIPTION, priceRangeLabel } from '@/lib/price-range';

describe('price words — one source', () => {
  it('covers exactly the tiers the backend accepts (VALID_PRICE_RANGES)', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'backend', 'src', 'validators', 'establishmentValidation.js'),
      'utf8',
    );
    const list = /const VALID_PRICE_RANGES = \[([^\]]*)\]/.exec(source)?.[1];
    expect(list).toBeDefined();
    const backend = [...list!.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    expect(backend.length).toBeGreaterThan(0);

    expect(Object.keys(PRICE_DESCRIPTION).sort()).toEqual([...backend].sort());
    expect([...PRICE_RANGES].sort()).toEqual([...backend].sort());
  });

  it('the filters label each tier with the same words', () => {
    for (const opt of PRICE_OPTIONS) {
      expect(opt.label).toBe(`${opt.value} · ${PRICE_DESCRIPTION[opt.value]}`);
    }
  });
});

describe('partner wizard — «Средний чек»', () => {
  it('each chip names its tier in words, and the saved value is the bare tier', () => {
    const patch = jest.fn();
    render(<BasicInfoSection form={emptyForm()} patch={patch} />);

    for (const tier of PRICE_RANGES) {
      expect(
        screen.getByRole('button', { name: priceRangeLabel(tier) }),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: '$$ · до 50 руб' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '$$ · до 50 руб' }));
    expect(patch).toHaveBeenCalledWith({ priceRange: '$$' });
  });

  it('the chips wrap on a narrow screen rather than run off it', () => {
    // jsdom lays nothing out: the guard is the wrapping row itself.
    render(<BasicInfoSection form={emptyForm()} patch={jest.fn()} />);
    expect(screen.getByTestId('price-range-chips')).toHaveClass('flex-wrap');
  });
});
