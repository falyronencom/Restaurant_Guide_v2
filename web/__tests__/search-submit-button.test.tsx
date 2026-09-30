import { render, screen } from '@testing-library/react';

import { SearchSubmitButton } from '@/components/home/SearchSubmitButton';

/*
 * The search boxes' submit button. While the results render (a navigation
 * transition — 1–2 s for a fresh phrase at the smart endpoint) it must show
 * that something is happening, visually and to a screen reader; otherwise it
 * is the plain «›» it always was. The useTransition wiring in HeroSearch /
 * CatalogSearch is verified live (a mocked router settles instantly).
 */
describe('SearchSubmitButton', () => {
  it('idle: the «›» glyph, labelled «Найти», not busy', () => {
    render(<SearchSubmitButton pending={false} />);

    const button = screen.getByRole('button', { name: 'Найти' });
    expect(button).toHaveTextContent('›');
    expect(button).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByTestId('search-pending')).not.toBeInTheDocument();
  });

  it('pending: a spinner instead of the glyph, labelled «Ищем…», busy', () => {
    render(<SearchSubmitButton pending />);

    const button = screen.getByRole('button', { name: 'Ищем…' });
    expect(button).not.toHaveTextContent('›');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('search-pending')).toBeInTheDocument();
  });

  it('stays a submit button in both states (the form submits through it)', () => {
    const { rerender } = render(<SearchSubmitButton pending={false} />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    rerender(<SearchSubmitButton pending />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('button')).not.toBeDisabled();
  });
});
