'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import { FileText, Star, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  E1_MIN_PHOTOS,
  MAX_MENU_PDFS,
  MEDIA_LIMITS,
} from '@/lib/partner/constants';
import type { WizardPdf, WizardPhoto } from '@/lib/partner/form';
import {
  uploadMedia,
  uploadMediaToEstablishment,
  validateMediaFileName,
} from '@/lib/partner/upload';
import { cn } from '@/lib/utils';

import { Field, SectionCard } from './primitives';
import type { SectionProps } from './types';

/** Edit mode passes the establishment id (PDF-add routing) + the OCR-retry handler. */
type MediaSectionProps = SectionProps & {
  establishmentId?: string;
  onRetryOcr?: () => void;
};

/*
 * Media — two buckets (Decision: photos[type=interior] / menu[photo + PDF≤2]).
 * Files upload through the streaming proxy (uploadMedia) to temp Cloudinary URLs;
 * the create payload materializes them. primary_photo is chosen from interior
 * photos. All uploads in one picker batch are awaited, THEN the form is patched
 * once (a per-file patch would read stale state across the loop).
 */
export function MediaSection({
  form,
  patch,
  disabled,
  establishmentId,
  onRetryOcr,
}: MediaSectionProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const interiorRef = useRef<HTMLInputElement>(null);
  const menuPhotoRef = useRef<HTMLInputElement>(null);
  const menuPdfRef = useRef<HTMLInputElement>(null);

  const addPhotos = async (
    files: FileList | null,
    bucket: 'interior' | 'menu',
  ) => {
    if (!files?.length) return;
    const current =
      bucket === 'interior' ? form.interiorPhotos : form.menuPhotos;
    const cap = bucket === 'interior' ? MEDIA_LIMITS.interior : MEDIA_LIMITS.menu;
    setBusy(true);
    setError(null);
    const added: WizardPhoto[] = [];
    for (const file of Array.from(files)) {
      if (current.length + added.length >= cap) {
        setError(`Достигнут лимит — максимум ${cap} фото.`);
        break;
      }
      // Extension pre-check: the OS-supplied mimetype can lie (.ai as PDF), so
      // reject by name before spending the upload round-trip.
      const invalid = validateMediaFileName(file.name, 'photo');
      if (invalid) {
        setError(invalid);
        break;
      }
      const r = await uploadMedia(file, bucket);
      if (!r.ok) {
        setError(r.message);
        break;
      }
      added.push({
        url: r.media.url,
        thumbnail_url: r.media.thumbnail_url,
        preview_url: r.media.preview_url,
      });
    }
    if (added.length) {
      if (bucket === 'interior') {
        const next = [...form.interiorPhotos, ...added];
        patch({
          interiorPhotos: next,
          primaryPhotoUrl: form.primaryPhotoUrl ?? next[0]?.url ?? null,
        });
      } else {
        patch({ menuPhotos: [...form.menuPhotos, ...added] });
      }
    }
    setBusy(false);
  };

  const addPdfs = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const added: WizardPdf[] = [];
    for (const file of Array.from(files)) {
      if (form.menuPdfs.length + added.length >= MAX_MENU_PDFS) {
        setError(`Максимум ${MAX_MENU_PDFS} PDF меню.`);
        break;
      }
      const invalid = validateMediaFileName(file.name, 'pdf');
      if (invalid) {
        setError(invalid);
        break;
      }
      // In edit mode a PDF must attach to the establishment (POST /:id/media —
      // the only path that attaches + OCRs it); in create it goes to temp upload.
      const r = establishmentId
        ? await uploadMediaToEstablishment(file, establishmentId, 'menu')
        : await uploadMedia(file, 'menu');
      if (!r.ok) {
        setError(r.message);
        break;
      }
      added.push({
        url: r.media.url,
        thumbnail_url: r.media.thumbnail_url,
        preview_url: r.media.preview_url,
        file_name: file.name,
      });
    }
    if (added.length) patch({ menuPdfs: [...form.menuPdfs, ...added] });
    setBusy(false);
  };

  const removeInterior = (url: string) => {
    const next = form.interiorPhotos.filter((p) => p.url !== url);
    patch({
      interiorPhotos: next,
      primaryPhotoUrl:
        form.primaryPhotoUrl === url
          ? (next[0]?.url ?? null)
          : form.primaryPhotoUrl,
    });
  };

  return (
    <SectionCard
      id="section-media"
      title="Фотографии и меню"
      description={`Фото заведения (от ${E1_MIN_PHOTOS} для публикации) и меню — фото или PDF.`}
    >
      {/* Interior photos */}
      <Field label={`Фото заведения — ${form.interiorPhotos.length}/${MEDIA_LIMITS.interior}`}>
        <div className="flex flex-wrap gap-3">
          {form.interiorPhotos.map((p) => (
            <Thumb
              key={p.url}
              src={p.thumbnail_url ?? p.url}
              primary={form.primaryPhotoUrl === p.url}
              disabled={disabled}
              onPrimary={() => patch({ primaryPhotoUrl: p.url })}
              onRemove={() => removeInterior(p.url)}
            />
          ))}
          {!disabled && (
            <UploadTile
              busy={busy}
              onClick={() => interiorRef.current?.click()}
            />
          )}
        </div>
        <input
          ref={interiorRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addPhotos(e.target.files, 'interior');
            e.target.value = '';
          }}
        />
        <p className="text-caption-m text-figma-text-grey">
          Первое фото станет обложкой — отметьте звездой нужное.
        </p>
      </Field>

      {/* Menu photos */}
      <Field label={`Фото меню — ${form.menuPhotos.length}/${MEDIA_LIMITS.menu}`}>
        <div className="flex flex-wrap gap-3">
          {form.menuPhotos.map((p) => (
            <Thumb
              key={p.url}
              src={p.thumbnail_url ?? p.url}
              disabled={disabled}
              onRemove={() =>
                patch({
                  menuPhotos: form.menuPhotos.filter((x) => x.url !== p.url),
                })
              }
            />
          ))}
          {!disabled && (
            <UploadTile
              busy={busy}
              onClick={() => menuPhotoRef.current?.click()}
            />
          )}
        </div>
        <input
          ref={menuPhotoRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addPhotos(e.target.files, 'menu');
            e.target.value = '';
          }}
        />
      </Field>

      {/* Menu PDFs */}
      <Field label={`Меню в PDF — ${form.menuPdfs.length}/${MAX_MENU_PDFS}`}>
        <div className="flex flex-wrap gap-3">
          {form.menuPdfs.map((pdf) => (
            <div
              key={pdf.url}
              className="relative flex w-40 items-center gap-2 rounded-m border border-border bg-background p-2"
            >
              <FileText className="size-5 shrink-0 text-brand" />
              <span className="line-clamp-2 text-caption-m text-foreground">
                {pdf.file_name}
              </span>
              {!disabled && (
                <button
                  type="button"
                  aria-label="Удалить PDF"
                  onClick={() =>
                    patch({
                      menuPdfs: form.menuPdfs.filter((x) => x.url !== pdf.url),
                    })
                  }
                  className="absolute -top-2 -right-2 rounded-full bg-background p-0.5 text-figma-text-dark shadow-sm"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          ))}
          {!disabled && form.menuPdfs.length < MAX_MENU_PDFS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => menuPdfRef.current?.click()}
            >
              <FileText className="size-4" />
              Загрузить PDF
            </Button>
          )}
        </div>
        <input
          ref={menuPdfRef}
          type="file"
          accept=".pdf,application/pdf"
          hidden
          onChange={(e) => {
            void addPdfs(e.target.files);
            e.target.value = '';
          }}
        />
      </Field>

      {busy && (
        <p className="text-caption-m text-figma-text-grey">Загрузка…</p>
      )}
      {error && <p className="text-caption-m text-error-dark">{error}</p>}

      {establishmentId &&
        onRetryOcr &&
        (form.menuPhotos.length > 0 || form.menuPdfs.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onRetryOcr}>
              Обновить распознавание меню
            </Button>
            <span className="text-caption-m text-figma-text-grey">
              если новые фото меню не распознались
            </span>
          </div>
        )}
    </SectionCard>
  );
}

function Thumb({
  src,
  primary,
  disabled,
  onPrimary,
  onRemove,
}: {
  src: string;
  primary?: boolean;
  disabled?: boolean;
  onPrimary?: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        'relative size-24 overflow-hidden rounded-m border bg-muted',
        primary ? 'border-brand ring-2 ring-brand/40' : 'border-border',
      )}
    >
      <Image src={src} alt="" fill sizes="96px" className="object-cover" />
      {!disabled && (
        <>
          {onPrimary && (
            <button
              type="button"
              aria-label="Сделать обложкой"
              onClick={onPrimary}
              className={cn(
                'absolute bottom-1 left-1 rounded-full p-1',
                primary
                  ? 'bg-brand text-text-on-primary'
                  : 'bg-background/80 text-figma-text-dark',
              )}
            >
              <Star className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            aria-label="Удалить фото"
            onClick={onRemove}
            className="absolute top-1 right-1 rounded-full bg-background/80 p-0.5 text-figma-text-dark"
          >
            <X className="size-4" />
          </button>
        </>
      )}
    </div>
  );
}

function UploadTile({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex size-24 flex-col items-center justify-center gap-1 rounded-m border border-dashed border-border bg-background text-figma-text-grey transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
    >
      <Upload className="size-5" />
      <span className="text-caption-s">Добавить</span>
    </button>
  );
}
