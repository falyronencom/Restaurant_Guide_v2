import type { Metadata } from 'next';
import Link from 'next/link';

import {
  ACCOUNT_DELETION_WORD,
  DELETED_ITEMS,
  DRAFTS_ITEM,
  KEPT_ITEMS,
  SUPPORT_EMAIL,
} from '@/lib/account/deletion';

/*
 * /udalenie-uchetki — how to delete a Nirivio account (brief В1, 18.10.2026).
 * The page Google Play links to: deletion without the app, and what is
 * deleted and what stays. Static RSC, no session: anyone can read it, signed
 * in or not. Indexed — a person searching «удалить учётку Nirivio» should find
 * it.
 *
 * Without signing in: a letter to support, which the operator answers with
 * scripts/delete-account.js — the same deletion as the button. The letter
 * proves nothing by itself (a sender's address can be forged, and an
 * establishment sees a guest's phone in a booking), so support confirms with
 * the holder first. A reply to the account's address proves the address. A
 * phone proves only the number: no phone is verified when an account is made
 * (Phase 3.5 review, 18.10.2026), so support asks what the holder knows (the
 * name on the account, roughly when it was made) before it calls the number.
 * A phone account cannot sign in anywhere now — the app, like the site, signs
 * in by e-mail only until SMS comes (Coordinator, 19.10.2026, PR #99): the
 * letter is its way. 15 days — the term law 99-З gives for an answer.
 */

export const metadata: Metadata = {
  // The layout's template adds «| Nirivio».
  title: 'Как удалить учётку',
  description:
    'Удалить учётку Nirivio можно в приложении, на сайте или письмом в поддержку. Что удаляется и что остаётся без имени.',
  alternates: { canonical: '/udalenie-uchetki' },
};

export default function AccountDeletionPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-l py-xl">
      <h1 className="font-display text-display-s text-foreground">
        Как удалить учётку Nirivio
      </h1>
      <p className="mt-s text-body-m text-figma-text-grey">
        Учётку можно удалить самому — в приложении или на сайте. Удаление
        происходит сразу, вернуть учётку нельзя.
      </p>

      <section className="mt-l flex flex-col gap-s rounded-card bg-figma-bg-warm p-l">
        <h2 className="text-label-l text-foreground">В приложении</h2>
        <p className="text-body-m text-foreground">
          «Профиль» → «Показать профиль» → «Мои данные» → «Удалить учётку».
          Введите слово {ACCOUNT_DELETION_WORD} и нажмите «Удалить учётку».
        </p>
      </section>

      <section className="mt-m flex flex-col gap-s rounded-card bg-figma-bg-warm p-l">
        <h2 className="text-label-l text-foreground">На сайте</h2>
        <p className="text-body-m text-foreground">
          <Link
            href="/login?returnTo=/profile"
            className="font-medium text-brand transition-colors hover:text-brand-dark"
          >
            Войдите
          </Link>{' '}
          и откройте «Профиль» → «Удалить учётку». Введите слово{' '}
          {ACCOUNT_DELETION_WORD} и нажмите «Удалить учётку».
        </p>
      </section>

      <section className="mt-m flex flex-col gap-s rounded-card bg-figma-bg-warm p-l">
        <h2 className="text-label-l text-foreground">Без входа</h2>
        <p className="text-body-m text-foreground">
          Напишите на{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Удаление учётки')}`}
            className="font-medium text-brand transition-colors hover:text-brand-dark"
          >
            {SUPPORT_EMAIL}
          </a>{' '}
          с почты, на которую заведена учётка: мы ответим на этот адрес и
          попросим подтвердить удаление. Удалим учётку в течение 15 дней.
        </p>
        <p className="text-body-m text-foreground">
          Учётка заведена на номер телефона? Войти по номеру сейчас нельзя ни
          в приложении, ни на сайте — напишите нам с любой почты: укажите
          номер, имя в профиле и примерно когда вы завели учётку. Мы сверим их
          с учёткой и свяжемся с вами по этому номеру.
        </p>
        <p className="text-body-m text-foreground">
          Если у вас есть карточки заведений, их сначала нужно передать другому
          владельцу — напишите в поддержку, это делается вместе с удалением.
        </p>
      </section>

      <section className="mt-l flex flex-col gap-s">
        <h2 className="text-label-l text-foreground">Что удаляется</h2>
        <ul className="list-disc pl-l text-body-m text-foreground">
          {[...DELETED_ITEMS, DRAFTS_ITEM].map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section className="mt-m flex flex-col gap-s">
        <h2 className="text-label-l text-foreground">Что остаётся без вашего имени</h2>
        <ul className="list-disc pl-l text-body-m text-foreground">
          {KEPT_ITEMS.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="text-body-m text-figma-text-grey">
          Новую учётку можно завести на ту же почту или телефон.
        </p>
      </section>
    </main>
  );
}
