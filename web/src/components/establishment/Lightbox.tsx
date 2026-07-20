'use client';

/**
 * PhotoLightbox — full-screen in-page photo viewer (Booking.com reference):
 * arrow navigation (buttons + ←/→ keys), swipe on touch, thumbnail strip,
 * «N / M» counter, Esc / backdrop-click to close.
 *
 * Provider + Trigger pattern so the consuming Server Components (Gallery,
 * MenuBlock) keep their server-rendered markup: tiles stay RSC and wrap their
 * <Image> in a LightboxTrigger (a plain button); one provider per photo set
 * hosts the dialog. Built on Base UI Dialog primitives (same as ui/dialog) for
 * focus trap / Esc / aria; the layout is custom full-screen, not the centered
 * modal skin.
 *
 * PDF menus never enter a lightbox — they keep the preview + download flow.
 */

import Image from 'next/image';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

import { cn } from '@/lib/utils';

export type LightboxPhoto = {
  id: string;
  url: string;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
};

const LightboxContext = createContext<{
  openAt: (index: number) => void;
} | null>(null);

type LightboxProviderProps = {
  photos: LightboxPhoto[];
  /** Accessible dialog name, e.g. «Фотографии — MARBL». */
  label: string;
  children: React.ReactNode;
};

/** Minimum horizontal pointer travel (px) recognised as a swipe. */
const SWIPE_THRESHOLD = 48;

export function LightboxProvider({
  photos,
  label,
  children,
}: LightboxProviderProps) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const swipeStartX = useRef<number | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);

  const count = photos.length;
  const openAt = useCallback((i: number) => {
    setIndex(i);
    setOpen(true);
  }, []);
  const showPrev = useCallback(
    () => setIndex((i) => (i - 1 + count) % count),
    [count],
  );
  const showNext = useCallback(
    () => setIndex((i) => (i + 1) % count),
    [count],
  );

  // Keyboard navigation while open. Capture phase: with focus inside the popup
  // (e.g. on a thumbnail) Base UI stops keydown propagation, so a bubble
  // listener on window never fires — verified live on 2026-07-20. Escape is
  // ALSO handled here (idempotent with the Dialog's own Esc): Base UI's Esc
  // path depends on focus being inside the popup, which is not guaranteed with
  // custom external triggers.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (count < 2) return;
      if (e.key === 'ArrowLeft') showPrev();
      if (e.key === 'ArrowRight') showNext();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, count, showPrev, showNext]);

  // Keep the active thumbnail in view (guarded: jsdom lacks scrollIntoView).
  useEffect(() => {
    if (!open) return;
    activeThumbRef.current?.scrollIntoView?.({
      inline: 'center',
      block: 'nearest',
    });
  }, [open, index]);

  const photo = photos[index] ?? photos[0];

  return (
    <LightboxContext.Provider value={{ openAt }}>
      {children}
      {photo ? (
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Backdrop className='fixed inset-0 z-50 bg-black/90' />
            <DialogPrimitive.Popup
              aria-label={label}
              className='fixed inset-0 z-50 flex flex-col outline-none'
            >
              {/* Top bar: counter + close */}
              <div className='flex items-center justify-between p-3 md:p-4'>
                <span
                  aria-live='polite'
                  className='rounded-m bg-black/50 px-3 py-1 text-body-s text-text-on-primary'
                >
                  {index + 1} / {count}
                </span>
                <DialogPrimitive.Close
                  aria-label='Закрыть просмотр'
                  className='rounded-full bg-black/50 p-2 text-text-on-primary transition-colors hover:bg-black/70'
                >
                  <X className='size-5' aria-hidden='true' />
                </DialogPrimitive.Close>
              </div>

              {/* Main photo area — click on the empty space closes */}
              <div
                className='relative flex min-h-0 flex-1 items-center justify-center'
                onClick={(e) => {
                  if (e.target === e.currentTarget) setOpen(false);
                }}
                onPointerDown={(e) => {
                  swipeStartX.current = e.clientX;
                }}
                onPointerUp={(e) => {
                  const start = swipeStartX.current;
                  swipeStartX.current = null;
                  if (start === null || count < 2) return;
                  const delta = e.clientX - start;
                  if (delta > SWIPE_THRESHOLD) showPrev();
                  else if (delta < -SWIPE_THRESHOLD) showNext();
                }}
              >
                {count > 1 ? (
                  <button
                    type='button'
                    aria-label='Предыдущее фото'
                    onClick={showPrev}
                    className='absolute left-2 z-10 rounded-full bg-black/50 p-2 text-text-on-primary transition-colors hover:bg-black/70 md:left-4 md:p-3'
                  >
                    <ChevronLeft className='size-6' aria-hidden='true' />
                  </button>
                ) : null}

                <div className='relative h-full w-full max-w-5xl px-2 md:px-16'>
                  {/* Full-res original for the main stage (preview_url is
                      800×600 — visible upscale on desktop); thumbs keep the
                      small renditions. */}
                  <Image
                    key={photo.id}
                    src={photo.url}
                    alt={photo.caption ?? label}
                    fill
                    sizes='100vw'
                    className='pointer-events-none object-contain'
                    priority
                  />
                </div>

                {count > 1 ? (
                  <button
                    type='button'
                    aria-label='Следующее фото'
                    onClick={showNext}
                    className='absolute right-2 z-10 rounded-full bg-black/50 p-2 text-text-on-primary transition-colors hover:bg-black/70 md:right-4 md:p-3'
                  >
                    <ChevronRight className='size-6' aria-hidden='true' />
                  </button>
                ) : null}
              </div>

              {/* Caption + thumbnail strip */}
              <div className='flex flex-col gap-2 p-3 md:p-4'>
                {photo.caption ? (
                  <p className='text-center text-body-s text-text-on-primary/80'>
                    {photo.caption}
                  </p>
                ) : null}
                {count > 1 ? (
                  <div
                    className='flex justify-start gap-2 overflow-x-auto py-1 md:justify-center'
                    style={{ scrollbarWidth: 'none' }}
                  >
                    {photos.map((p, i) => (
                      <button
                        key={p.id}
                        type='button'
                        ref={i === index ? activeThumbRef : undefined}
                        aria-label={`Фото ${i + 1}`}
                        aria-current={i === index}
                        onClick={() => setIndex(i)}
                        className={cn(
                          'relative aspect-[4/3] h-14 shrink-0 overflow-hidden rounded-s transition-opacity',
                          i === index
                            ? 'opacity-100 ring-2 ring-white'
                            : 'opacity-60 hover:opacity-90',
                        )}
                      >
                        <Image
                          src={p.thumbnailUrl ?? p.previewUrl ?? p.url}
                          alt=''
                          fill
                          sizes='75px'
                          className='object-cover'
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </DialogPrimitive.Popup>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      ) : null}
    </LightboxContext.Provider>
  );
}

type LightboxTriggerProps = {
  index: number;
  className?: string;
  'aria-label'?: string;
  children: React.ReactNode;
};

/**
 * A plain button opening the lightbox at the given photo index. Replaces the
 * previous «open original in a new tab» anchors tile-for-tile: pass the same
 * className the anchor carried.
 */
export function LightboxTrigger({
  index,
  className,
  'aria-label': ariaLabel,
  children,
}: LightboxTriggerProps) {
  const ctx = useContext(LightboxContext);
  if (!ctx) {
    throw new Error('LightboxTrigger must be rendered inside LightboxProvider');
  }
  return (
    <button
      type='button'
      aria-label={ariaLabel}
      className={cn('cursor-pointer text-left', className)}
      onClick={() => ctx.openAt(index)}
    >
      {children}
    </button>
  );
}
