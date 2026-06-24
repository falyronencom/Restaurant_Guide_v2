'use client';

import Link from 'next/link';
import { useEffect, useState, type ComponentProps } from 'react';

/*
 * SmartLink — progressive-enhancement wrapper around next/link that opens the
 * destination in a NEW TAB on desktop and the SAME tab on touch/mobile (D-2B).
 *
 * Why: the web is the desktop-primary platform (the mobile experience is the
 * separate native app), so opening establishments in new tabs — Booking-style
 * comparison across tabs — is the desktop default; mobile gracefully keeps
 * single-tab navigation.
 *
 * Progressive enhancement, NOT server/User-Agent detection — UA-detect would
 * vary the HTML by device and break the ISR cache of the pages these link to.
 * The server render and the first client render emit a plain same-tab link, so
 * the href is in the SSR HTML (SEO-safe) and works pre-JS and on mobile. After
 * hydration, desktop-capable devices (a fine pointer that can hover — a mouse,
 * not touch) upgrade to target=_blank. The capability check is deferred with
 * setTimeout(0) so it runs post-hydration: this avoids both a hydration mismatch
 * and the react-hooks set-state-in-effect rule (a lazy useState initializer
 * would touch window during the first render and mismatch). See
 * feedback_react_localstorage_hydration_defer.
 *
 * Use only for "branch out to a destination the user may want to compare" links
 * (establishment cards, the map preview card, the popular card) — NOT for
 * breadcrumbs or in-place navigation.
 */
export function SmartLink({
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, 'target' | 'rel'>) {
  const [newTab, setNewTab] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      setNewTab(window.matchMedia('(pointer: fine) and (hover: hover)').matches);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  return (
    <Link
      {...props}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </Link>
  );
}
