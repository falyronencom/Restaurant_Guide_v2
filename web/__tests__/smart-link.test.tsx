/**
 * SmartLink — desktop opens a new tab, touch/mobile stays in the same tab (D-2B).
 *
 * Progressive enhancement: the link renders same-tab on the server / first
 * client render (SEO-safe, mobile, pre-JS), then upgrades to target=_blank after
 * hydration ONLY on devices with a fine pointer that can hover (a mouse). These
 * tests mock next/link to a bare <a> (isolating SmartLink's own logic) and
 * matchMedia to drive the capability branch.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { SmartLink } from '@/components/SmartLink';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: { children?: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));

function mockPointer(fine: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: jest.fn().mockReturnValue({ matches: fine }),
  });
}

// The capability check is deferred with setTimeout(0); let that macrotask run.
async function flushDeferred() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('SmartLink', () => {
  it('renders a same-tab link on the server / first render (no target yet)', () => {
    mockPointer(true);
    render(<SmartLink href='/x'>go</SmartLink>);
    // Synchronous first render — the deferred capability check has not run.
    expect(screen.getByRole('link')).not.toHaveAttribute('target');
  });

  it('upgrades to a new tab on desktop (fine pointer + hover) after hydration', async () => {
    mockPointer(true);
    render(<SmartLink href='/x'>go</SmartLink>);

    await waitFor(() =>
      expect(screen.getByRole('link')).toHaveAttribute('target', '_blank'),
    );
    expect(screen.getByRole('link')).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(window.matchMedia).toHaveBeenCalledWith(
      '(pointer: fine) and (hover: hover)',
    );
  });

  it('stays in the same tab on touch / mobile', async () => {
    mockPointer(false);
    render(<SmartLink href='/x'>go</SmartLink>);

    await flushDeferred();
    expect(screen.getByRole('link')).not.toHaveAttribute('target');
    expect(screen.getByRole('link')).not.toHaveAttribute('rel');
  });

  it('forwards href and className', () => {
    mockPointer(false);
    render(
      <SmartLink href='/abc' className='card'>
        go
      </SmartLink>,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/abc');
    expect(link).toHaveClass('card');
  });
});
