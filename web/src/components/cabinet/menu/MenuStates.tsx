import Link from 'next/link';
import { AlertCircle, EyeOff, Hourglass, Loader2, MenuSquare, SearchX } from 'lucide-react';

import { verifyEmailHref } from '@/lib/auth/verify-email-href';
import { CONFIRM_EMAIL, RECOGNITION_TEXTS } from '@/lib/partner/cabinet-texts';
import { cardSectionHref } from '@/lib/partner/card-sections';
import type { MenuRecognition } from '@/lib/partner/menu';
import { cn } from '@/lib/utils';

/*
 * The states of the «Меню» section — the app's approved texts with the site's
 * section name (lib/partner/cabinet-texts.ts RECOGNITION_TEXTS): a whole-page
 * message when the list is empty, a banner over a list that has lines.
 */

/** The file itself cannot be read — a restart reads it the same way: another file helps. */
const fileCannotBeRead = (r: MenuRecognition) => r.cause === 'unreadable' || r.cause === 'over_limit';

const failedHint = (r: MenuRecognition) =>
  fileCannotBeRead(r) ? RECOGNITION_TEXTS.failed.hintOtherFile : RECOGNITION_TEXTS.failed.hintRestart;

/** A confirmed e-mail would help: the state is «not started», or a failure of the service. */
export function emailHelps(recognition: MenuRecognition | null): boolean {
  return (
    recognition?.status === 'not_started' ||
    (recognition?.status === 'failed' && recognition.cause === 'service_failure')
  );
}

/** T5 — for an account without a confirmed e-mail. */
export function ConfirmEmailLine({ cardId }: { cardId: string }) {
  return (
    <p className="text-body-s text-figma-text-dark">
      {CONFIRM_EMAIL.text}{' '}
      <Link
        href={verifyEmailHref(cardSectionHref(cardId, 'menu'))}
        className="text-foreground underline underline-offset-2 hover:text-brand-dark"
      >
        {CONFIRM_EMAIL.link}
      </Link>
    </p>
  );
}

function Message({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-s rounded-[var(--radius-l)] border border-border bg-background px-l py-xl text-center">
      <span className="text-figma-text-grey" aria-hidden="true">
        {icon}
      </span>
      <h2 className="font-display text-headline-s text-foreground">{title}</h2>
      <div className="flex max-w-lg flex-col gap-s text-body-m text-figma-text-grey">{children}</div>
    </div>
  );
}

/**
 * The list is empty: what the state says (the app's precedence). `hidden` —
 * recognised, and every line hidden by the moderator («Позиции не
 * показываются»); the caller hides the restart then.
 */
export function EmptyMenuState({
  recognition,
  hidden,
  emailUnconfirmed,
  cardId,
}: {
  recognition: MenuRecognition;
  hidden: boolean;
  emailUnconfirmed: boolean;
  cardId: string;
}) {
  const t = RECOGNITION_TEXTS;
  const icon = 'size-12';
  switch (recognition.status) {
    case 'processing':
      return (
        <Message icon={<Loader2 className={cn(icon, 'animate-spin')} />} title={t.processing.title}>
          <p>{t.processing.hint}</p>
        </Message>
      );
    case 'failed':
      return (
        <Message icon={<AlertCircle className={icon} />} title={t.failed.title}>
          {recognition.reason && <p className="text-foreground">{recognition.reason}</p>}
          <p>{failedHint(recognition)}</p>
          {emailUnconfirmed && emailHelps(recognition) && <ConfirmEmailLine cardId={cardId} />}
        </Message>
      );
    case 'not_started':
      return (
        <Message icon={<Hourglass className={icon} />} title={t.notStarted.title}>
          <p>{t.notStarted.hint}</p>
          {emailUnconfirmed && <ConfirmEmailLine cardId={cardId} />}
        </Message>
      );
    case 'done':
      return hidden ? (
        <Message icon={<EyeOff className={icon} />} title={t.hidden.title}>
          <p>{t.hidden.hint}</p>
        </Message>
      ) : (
        <Message icon={<SearchX className={icon} />} title={t.nothingFound.title}>
          <p>{t.nothingFound.hint}</p>
        </Message>
      );
    case 'none':
      return (
        <Message icon={<MenuSquare className={icon} />} title={t.none.title}>
          <p>{t.none.hint}</p>
        </Message>
      );
  }
}

function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'error' | 'info';
  icon: React.ReactNode;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex gap-s rounded-[var(--radius-m)] border p-m',
        tone === 'error' ? 'border-error-light/40 bg-error/5' : 'border-border bg-background',
      )}
    >
      <span className={cn('mt-0.5 shrink-0', tone === 'error' ? 'text-error-dark' : 'text-figma-text-grey')}>
        {icon}
      </span>
      <div className="flex flex-col gap-1 text-body-s text-figma-text-dark">
        {title && <p className="font-medium text-foreground">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** Over a list that has lines: a file not recognised, not started, a re-read under way. */
export function MenuBanner({
  recognition,
  emailUnconfirmed,
  cardId,
}: {
  recognition: MenuRecognition;
  emailUnconfirmed: boolean;
  cardId: string;
}) {
  const t = RECOGNITION_TEXTS;
  switch (recognition.status) {
    case 'failed':
      return (
        <Banner tone="error" icon={<AlertCircle className="size-4" />} title={t.failed.bannerTitle}>
          {recognition.reason && <p className="text-foreground">{recognition.reason}</p>}
          <p>{failedHint(recognition)}</p>
          {emailUnconfirmed && emailHelps(recognition) && <ConfirmEmailLine cardId={cardId} />}
        </Banner>
      );
    case 'not_started':
      return (
        <Banner tone="info" icon={<Hourglass className="size-4" />} title={t.notStarted.title}>
          <p>{t.notStarted.hint}</p>
          {emailUnconfirmed && <ConfirmEmailLine cardId={cardId} />}
        </Banner>
      );
    case 'processing':
      return (
        <Banner tone="info" icon={<Loader2 className="size-4 animate-spin" />}>
          <p>{t.processingBanner}</p>
        </Banner>
      );
    default:
      return null;
  }
}

/** T9 — some lines are hidden by the moderator, the list is not empty. */
export function HiddenItemsNote() {
  return (
    <Banner tone="info" icon={<EyeOff className="size-4" />}>
      <p>{RECOGNITION_TEXTS.hiddenNote}</p>
    </Banner>
  );
}
