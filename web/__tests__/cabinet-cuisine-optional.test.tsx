/**
 * Кухня у бара и клуба — по желанию (решение Координатора В5, 17.10.2026;
 * сверка находок тестировщика с сайтом, 18.10, пункт 34): что партнёр читает
 * в разделе «Классификация» и в списке готовности справа.
 */
import { render, screen } from '@testing-library/react';

import { ClassificationSection } from '@/components/cabinet/wizard/ClassificationSection';
import { StickySidebar } from '@/components/cabinet/wizard/StickySidebar';
import { emptyForm } from '@/lib/partner/form';
import { evaluateE1 } from '@/lib/partner/validation';

function renderSection(categories: string[]) {
  render(
    <ClassificationSection
      form={{ ...emptyForm(), categories }}
      patch={() => {}}
      disabled={false}
    />,
  );
}

function renderSidebar(cuisineOptional: boolean) {
  render(
    <StickySidebar
      e1={evaluateE1(emptyForm())}
      completeness={0}
      serverScore={null}
      canSubmit={false}
      showSubmit
      submitting={false}
      onSubmit={() => {}}
      saveLabel=""
      error={null}
      notice={null}
      cuisineOptional={cuisineOptional}
    />,
  );
}

describe('подпись раздела «Классификация»', () => {
  it('говорит, что бару и клубу кухню можно не выбирать', () => {
    renderSection([]);
    expect(
      screen.getByText(/Бару и клубу кухню можно не выбирать/),
    ).toBeInTheDocument();
  });

  it.each([[['Бар']], [['Клуб']]])('%j: поле кухонь — «по желанию»', (categories) => {
    renderSection(categories);
    expect(screen.getByText('Кухни — до 3, по желанию')).toBeInTheDocument();
  });

  it.each([[['Ресторан']], [['Бар', 'Ресторан']], [[]]])(
    '%j: поле кухонь без «по желанию»',
    (categories) => {
      renderSection(categories);
      expect(screen.getByText('Кухни — до 3')).toBeInTheDocument();
      expect(screen.queryByText(/по желанию/)).not.toBeInTheDocument();
    },
  );
});

describe('список готовности', () => {
  it('у бара и клуба пункт не просит кухню', () => {
    renderSidebar(true);
    expect(screen.getByText('Категория (кухня — по желанию)')).toBeInTheDocument();
    expect(screen.queryByText('Категория и кухня')).not.toBeInTheDocument();
  });

  it('у остальных — «Категория и кухня»', () => {
    renderSidebar(false);
    expect(screen.getByText('Категория и кухня')).toBeInTheDocument();
  });
});
