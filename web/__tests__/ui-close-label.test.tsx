/**
 * The close control of the site's windows says «Закрыть» to a screen reader —
 * not the English "Close" the UI kit came with (finding of thread «Отзыв без
 * текста», accepted by the Coordinator 23.11.2026). The X of every dialog
 * (ui/dialog DialogContent) and side panel (ui/sheet SheetContent) carries it
 * as its hidden name; the dialog footer's own close button (DialogFooter
 * showCloseButton, unused on the site today) shows the same word. Real base-ui
 * primitives under jsdom (polyfills in jest.setup).
 */
import { render, screen } from '@testing-library/react';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

it('the X of a dialog is named «Закрыть»', () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Окно</DialogTitle>
      </DialogContent>
    </Dialog>,
  );

  expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
});

it('the X of a side panel is named «Закрыть»', () => {
  render(
    <Sheet open>
      <SheetContent>
        <SheetTitle>Панель</SheetTitle>
      </SheetContent>
    </Sheet>,
  );

  expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
});

it('the dialog footer\'s own close button says «Закрыть»', () => {
  render(
    <Dialog open>
      <DialogContent showCloseButton={false}>
        <DialogTitle>Окно</DialogTitle>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>,
  );

  expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveTextContent('Закрыть');
});
