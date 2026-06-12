/**
 * Wizard client model + payload builders (Phase C Slice 1, Segment B).
 *
 * `WizardFormState` is the single client-side representation shared by every
 * wizard section, the sticky sidebar, the completeness mirror, and the E1 gate.
 * `toCreatePayload` / `toUpdatePayload` are the web analog of mobile's
 * partner_registration.dart toJson — the one place form state becomes a backend
 * contract. Edit-mode hydration (`fromDetail`) lands in Commit 4 alongside the
 * media image/PDF separation it needs.
 */

import type {
  CreateEstablishmentPayload,
  DayHours,
  UpdateEstablishmentPayload,
  WorkingHoursPayload,
} from '@/lib/api/types';
import {
  CITY_CENTER,
  DAY_KEYS,
  DEFAULT_CITY_CENTER,
  type DayKey,
} from '@/lib/partner/constants';

/** An uploaded establishment/menu photo (temp-upload result, minus PDF fields). */
export type WizardPhoto = {
  url: string;
  thumbnail_url?: string;
  preview_url?: string;
};

/** An uploaded menu PDF (temp-upload result + file_name supplied by the client). */
export type WizardPdf = {
  url: string;
  thumbnail_url: string;
  preview_url: string;
  file_name: string;
};

/** Per-day hours as edited in the form (separate from the wire DayHours shape). */
export type DayHoursForm = {
  isOpen: boolean;
  open: string; // 'HH:MM'
  close: string; // 'HH:MM'
};

export type WizardFormState = {
  // Classification
  categories: string[]; // Cyrillic canon, ≤ MAX_CATEGORIES
  cuisines: string[]; // Cyrillic canon, ≤ MAX_CUISINES
  // Basic
  name: string;
  description: string;
  phone: string;
  email: string;
  website: string;
  priceRange: string; // '' | '$' | '$$' | '$$$'
  attributes: string[]; // selected attribute keys (subset of ATTRIBUTE_KEYS)
  // Media
  interiorPhotos: WizardPhoto[]; // type=interior
  menuPhotos: WizardPhoto[]; // type=menu (image)
  menuPdfs: WizardPdf[]; // type=menu (pdf), ≤ MAX_MENU_PDFS
  primaryPhotoUrl: string | null; // chosen from interiorPhotos
  // Address
  city: string;
  street: string;
  building: string;
  latitude: number | null;
  longitude: number | null;
  // Hours
  workingHours: Record<DayKey, DayHoursForm>;
};

/** A pristine wizard state — all days closed (no silent defaults, Q10). */
export function emptyForm(): WizardFormState {
  const workingHours = {} as Record<DayKey, DayHoursForm>;
  for (const day of DAY_KEYS) {
    workingHours[day] = { isOpen: false, open: '', close: '' };
  }
  return {
    categories: [],
    cuisines: [],
    name: '',
    description: '',
    phone: '',
    email: '',
    website: '',
    priceRange: '',
    attributes: [],
    interiorPhotos: [],
    menuPhotos: [],
    menuPdfs: [],
    primaryPhotoUrl: null,
    city: '',
    street: '',
    building: '',
    latitude: null,
    longitude: null,
    workingHours,
  };
}

/** Join street + building into the single backend `address` string. */
export function buildAddress(form: WizardFormState): string {
  return [form.street.trim(), form.building.trim()].filter(Boolean).join(', ');
}

function buildWorkingHours(form: WizardFormState): WorkingHoursPayload {
  const wh: WorkingHoursPayload = {};
  for (const day of DAY_KEYS) {
    const d = form.workingHours[day];
    wh[day] = d.isOpen
      ? ({ is_open: true, open: d.open, close: d.close } satisfies DayHours)
      : ({ is_open: false } satisfies DayHours);
  }
  return wh;
}

function selectedAttributes(form: WizardFormState): Record<string, boolean> {
  const attrs: Record<string, boolean> = {};
  for (const key of form.attributes) attrs[key] = true;
  return attrs;
}

/**
 * Build the create payload. lat/lng fall back to the city-center assist
 * (Decision 5) when the partner has not geocoded/hand-edited. Optional fields are
 * omitted when empty (mirrors toJson) so the backend keeps its own defaults.
 */
export function toCreatePayload(
  form: WizardFormState,
): CreateEstablishmentPayload {
  const center = CITY_CENTER[form.city] ?? DEFAULT_CITY_CENTER;
  const attributes = selectedAttributes(form);

  const payload: CreateEstablishmentPayload = {
    name: form.name.trim(),
    categories: form.categories,
    cuisines: form.cuisines,
    city: form.city,
    address: buildAddress(form),
    latitude: form.latitude ?? center.lat,
    longitude: form.longitude ?? center.lng,
    working_hours: buildWorkingHours(form),
  };

  const description = form.description.trim();
  if (description) payload.description = description;
  const phone = form.phone.replace(/\s/g, '');
  if (phone) payload.phone = phone;
  const email = form.email.trim();
  if (email) payload.email = email;
  const website = form.website.trim();
  if (website) payload.website = website;
  if (form.priceRange) payload.price_range = form.priceRange;
  if (Object.keys(attributes).length > 0) payload.attributes = attributes;
  if (form.interiorPhotos.length) {
    payload.interior_photos = form.interiorPhotos.map((p) => p.url);
  }
  if (form.menuPhotos.length) {
    payload.menu_photos = form.menuPhotos.map((p) => p.url);
  }
  if (form.menuPdfs.length) payload.menu_pdfs = form.menuPdfs;
  if (form.primaryPhotoUrl) payload.primary_photo = form.primaryPhotoUrl;

  return payload;
}

/**
 * Build the update payload (desired-state PUT). Image media arrays are ALWAYS
 * included (even empty) so the backend's delete-missing/insert-new sync can
 * remove media the partner deleted. menu_pdfs are excluded — PUT does not process
 * them (asymmetry Q1); post-create PDFs go through POST /:id/media in Commit 4.
 */
export function toUpdatePayload(
  form: WizardFormState,
): UpdateEstablishmentPayload {
  const create = toCreatePayload(form);
  // PUT does not process menu_pdfs (asymmetry Q1) — drop it. Image arrays are
  // ALWAYS sent (even empty) so the backend's delete-missing sync can remove
  // media the partner deleted.
  delete create.menu_pdfs;
  return {
    ...create,
    interior_photos: form.interiorPhotos.map((p) => p.url),
    menu_photos: form.menuPhotos.map((p) => p.url),
  };
}
