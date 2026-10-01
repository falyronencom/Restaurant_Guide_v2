import { cn } from '@/lib/utils';

type Props = {
  /** A navigation to the results is in flight (useTransition's isPending). */
  pending: boolean;
  /** Sizing of the host box (padding, glyph size) — the two boxes differ. */
  className?: string;
};

/*
 * The orange «›» submit of the search boxes — home hero (HeroSearch) and
 * catalog banner (CatalogSearch).
 *
 * While the results render it shows a spinner and announces «Ищем…»: a fresh
 * phrase takes 1–2 s at the smart endpoint, and a button that shows nothing for
 * that long reads as broken. Not disabled — a second submit simply starts a
 * newer navigation, and a disabled control could strand the visitor if one
 * never settled.
 */
export function SearchSubmitButton({ pending, className }: Props) {
  return (
    <button
      type="submit"
      aria-label={pending ? 'Ищем…' : 'Найти'}
      aria-busy={pending}
      className={cn(
        'flex items-center justify-center bg-brand text-white transition-colors hover:bg-brand-dark',
        className,
      )}
    >
      {pending ? (
        <span
          aria-hidden="true"
          data-testid="search-pending"
          className="h-[20px] w-[20px] animate-spin rounded-full border-2 border-white/40 border-t-white"
        />
      ) : (
        '›'
      )}
    </button>
  );
}
