import Link from 'next/link';

/*
 * Partner-acquisition CTA in the home body — the "partners" audience (distinct
 * from the "users" Popular/category sections and the "investors" overall polish).
 *
 * Target = /login?returnTo=/cabinet/new (Coordinator-ratified Variant Y,
 * 2026-06-17). A logged-out visitor passes through /login (guardReturnTo accepts
 * this relative path), registers as a normal user, then lands straight in the
 * new-establishment wizard; the backend upgrades user→partner on the first
 * create. Same target as the header and footer CTAs for one coherent funnel.
 *
 * Copy is a sensible default — final wording is a Segment E (polish) concern.
 */
export function PartnerCtaSection() {
  return (
    <section className="bg-secondary">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-m px-l py-xxl text-center">
        <h2 className="font-display text-display-s text-foreground">
          У вас есть заведение?
        </h2>
        <p className="text-body-m text-text-secondary">
          Разместите его в Nirivio: фото, меню, часы работы и контакты — всё в
          одной карточке. Гости города найдут вас в каталоге и на карте.
        </p>
        <Link
          href="/login?returnTo=/cabinet/new"
          className="mt-s rounded-full bg-brand px-xl py-m text-label-l text-text-on-primary transition-colors hover:bg-brand-dark"
        >
          Добавить заведение
        </Link>
      </div>
    </section>
  );
}
