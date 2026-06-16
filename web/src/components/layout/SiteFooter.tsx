import Link from 'next/link';

import type { MetadataSlug } from '@/lib/api/types';

type Props = {
  cities: MetadataSlug[];
};

/*
 * Unified site footer — greenfield (no footer existed before). Addresses the
 * three audiences the public web serves: visitors (city links), partners (CTA
 * into the cabinet), and an «о сервисе» column reserved for legal/compliance
 * links (a separate pre-launch item — kept as a placeholder so the structure is
 * complete without dangling 404s).
 *
 * Pure presentational Server Component; `cities` comes from the (public)
 * layout's cached getMetadata() call.
 */
export function SiteFooter({ cities }: Props) {
  return (
    <footer className="mt-xxl border-t border-border bg-secondary">
      <div className="mx-auto grid max-w-6xl gap-xl px-l py-xl sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-s">
          <span className="font-wordmark text-headline-m font-bold text-foreground">
            NIRIVIO
          </span>
          <p className="text-body-m text-text-secondary">Вкусное рядом.</p>
        </div>

        <nav className="flex flex-col gap-s" aria-label="Города">
          <span className="text-label-m text-text-secondary">Города</span>
          {cities.map((c) => (
            <Link
              key={c.slug}
              href={`/${c.slug}`}
              className="text-body-m text-foreground transition-colors hover:text-brand-dark"
            >
              {c.name}
            </Link>
          ))}
        </nav>

        <nav className="flex flex-col gap-s" aria-label="Партнёрам">
          <span className="text-label-m text-text-secondary">Партнёрам</span>
          <Link
            href="/login?returnTo=/cabinet/new"
            className="text-body-m text-foreground transition-colors hover:text-brand-dark"
          >
            Добавить заведение
          </Link>
          <Link
            href="/login?returnTo=/cabinet"
            className="text-body-m text-foreground transition-colors hover:text-brand-dark"
          >
            Кабинет партнёра
          </Link>
        </nav>

        <div className="flex flex-col gap-s" aria-label="О сервисе">
          <span className="text-label-m text-text-secondary">О сервисе</span>
          {/* Legal pages (о нас, контакты, правовая информация) are a separate
              pre-launch compliance item — wire real hrefs when those routes
              exist. Placeholder keeps the footer column complete. */}
          <span className="text-body-m text-text-tertiary">
            Скоро: о нас, контакты, правовая информация
          </span>
        </div>
      </div>
    </footer>
  );
}
