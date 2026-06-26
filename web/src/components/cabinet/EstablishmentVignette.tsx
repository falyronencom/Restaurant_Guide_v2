import Image from 'next/image';
import Link from 'next/link';
import { Eye, Heart, MessageSquare, Star } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { formatRating } from '@/lib/establishment-helpers';
import type {
  EstablishmentStatus,
  PartnerEstablishmentListing,
} from '@/lib/api/types';
import { STATUS_LABELS, isAdminSuspended } from '@/lib/partner/status';
import { cn } from '@/lib/utils';

import { DeleteEstablishmentButton } from './DeleteEstablishmentButton';

/*
 * Cabinet establishment vignette (Phase C Slice 1, Segment B). Renders inside the
 * client dashboard. Surfaces the primary photo, status, engagement metrics,
 * completeness (base_score), rejection notes (rejected) / suspension reason
 * (admin-suspended), and the edit entry.
 */

const STATUS_BADGE: Record<EstablishmentStatus, string> = {
  draft: 'bg-gray-200 text-figma-text-dark',
  pending: 'bg-brand/15 text-brand-dark',
  active: 'bg-success-status/20 text-success-dark',
  rejected: 'bg-error/15 text-error-dark',
  suspended: 'bg-gray-300 text-figma-text-dark',
};

const EDIT_LABEL: Partial<Record<EstablishmentStatus, string>> = {
  draft: 'Продолжить',
  rejected: 'Исправить',
};

export function EstablishmentVignette({
  establishment: e,
  onDeleted,
}: {
  establishment: PartnerEstablishmentListing;
  onDeleted: (id: string) => void;
}) {
  const photo = e.primary_photo?.thumbnail_url ?? e.primary_photo?.url ?? null;
  const notes = e.moderation_notes;
  const rejectionEntries =
    e.status === 'rejected' && notes ? Object.entries(notes) : [];
  // Delete is offered only for draft/rejected — removing an active card with
  // reviews/engagement from the cabinet is intentionally not a one-click action.
  const canDelete = e.status === 'draft' || e.status === 'rejected';

  return (
    <article className="flex flex-col overflow-hidden rounded-l border border-border bg-background">
      <div className="relative aspect-[16/9] w-full bg-muted">
        {photo ? (
          <Image
            src={photo}
            alt={e.name}
            fill
            sizes="(max-width: 640px) 100vw, 50vw"
            className="object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-figma-text-grey">
            <span className="text-caption-l">Нет фото</span>
          </div>
        )}
        <span
          className={cn(
            'absolute top-2 left-2 rounded-s px-2 py-1 text-caption-m font-medium',
            STATUS_BADGE[e.status],
          )}
        >
          {STATUS_LABELS[e.status]}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-s p-m">
        <h3 className="line-clamp-1 font-display text-headline-s text-foreground">
          {e.name}
        </h3>
        <p className="line-clamp-1 text-body-s text-figma-text-grey">
          {e.city}
          {e.address ? `, ${e.address}` : ''}
        </p>

        <div className="flex flex-wrap items-center gap-m text-body-s text-figma-text-dark">
          <Metric icon={<Eye className="size-3.5" />} value={e.view_count} />
          <Metric icon={<Heart className="size-3.5" />} value={e.favorite_count} />
          <Metric
            icon={<MessageSquare className="size-3.5" />}
            value={e.review_count}
          />
          {e.average_rating != null && (
            <Metric
              icon={<Star className="size-3.5" />}
              value={formatRating(e.average_rating)}
            />
          )}
        </div>

        {e.base_score != null && <Completeness score={e.base_score} />}

        {rejectionEntries.length > 0 && (
          <div className="rounded-s border border-error-light/40 bg-error/5 p-s">
            <p className="text-caption-m font-medium text-error-dark">
              Причины отклонения:
            </p>
            <ul className="mt-1 list-inside list-disc text-caption-m text-figma-text-dark">
              {rejectionEntries.map(([field, comment]) => (
                <li key={field}>{comment}</li>
              ))}
            </ul>
          </div>
        )}

        {e.status === 'suspended' &&
          isAdminSuspended(notes) &&
          notes?.suspend_reason && (
            <p className="text-caption-m text-error-dark">
              Приостановлено: {notes.suspend_reason}
            </p>
          )}

        <div className="mt-auto flex items-center gap-2 pt-s">
          <Link
            href={`/cabinet/${e.id}/edit`}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'flex-1',
            )}
          >
            {EDIT_LABEL[e.status] ?? 'Редактировать'}
          </Link>
          {canDelete && (
            <DeleteEstablishmentButton
              establishmentId={e.id}
              establishmentName={e.name}
              onDeleted={onDeleted}
            />
          )}
        </div>
      </div>
    </article>
  );
}

function Metric({
  icon,
  value,
}: {
  icon: React.ReactNode;
  value: number | string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {icon}
      {value}
    </span>
  );
}

function Completeness({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className="flex items-center gap-s">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-caption-m text-figma-text-grey">{clamped}%</span>
    </div>
  );
}
