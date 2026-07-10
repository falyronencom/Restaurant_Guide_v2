/**
 * Public API — TypeScript Contracts
 *
 * Types mirror backend public projections (Brief 1):
 *   backend/src/projections/establishmentProjections.js
 *   backend/src/projections/reviewProjections.js
 *   backend/src/projections/menuItemProjections.js
 *
 * Source of truth: backend projections. On contract change, update backend
 * first, then re-derive here MANUALLY. (No code generation in Brief 2 scope.)
 *
 * Pagination convention: `totalPages` (public surface normalises from
 * reviewService's internal `pages` — see Discovery Report F4).
 */

// ============================================================================
// Pagination
// ============================================================================

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

// ============================================================================
// Establishment projections
// ============================================================================

/** Catalog list row — backend `toPublicEstablishmentListing`. */
export type PublicEstablishmentListing = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  city: string;
  city_slug: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  website: string | null;
  categories: string[];
  category_slug: string | null;
  cuisines: string[];
  price_range: string | null;
  /** JSONB — backend stores either string range or per-day object map */
  working_hours: unknown;
  attributes: unknown;
  status: string;
  primary_image_url: string | null;
  review_count: number;
  average_rating: number | null;
  favorite_count: number;
  booking_enabled: boolean;
  has_promotion: boolean;
  promotion_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /** Present only on radius searches (mobile/search), absent on /public catalog */
  distance_km?: number;
  distance?: number;
};

/** Full detail — backend `toPublicEstablishment`. Listing + media[] + promotions[] + email + special_hours + view_count. */
export type PublicEstablishmentDetail = PublicEstablishmentListing & {
  email: string | null;
  special_hours: unknown;
  view_count: number;
  media: PublicMedia[];
  promotions: PublicPromotion[];
};

/**
 * Map marker — backend `toPublicEstablishmentMapMarker`. Lean payload plus the
 * few preview-card fields (address, categories, category_slug, price_range,
 * review_count) the map's tap-to-preview card renders from, without a second
 * fetch. `category_slug` is null when the primary category is outside the canon.
 */
export type PublicEstablishmentMapMarker = {
  id: string;
  slug: string;
  name: string;
  city: string;
  city_slug: string | null;
  address: string;
  categories: string[];
  category_slug: string | null;
  price_range: string | null;
  latitude: number | null;
  longitude: number | null;
  primary_image_url: string | null;
  review_count: number;
  average_rating: number | null;
  has_promotion: boolean;
};

// ============================================================================
// Sub-types (Media / Promotion / Review / MenuItem)
// ============================================================================

/** Media row attached to detail projection. Backend `establishment_media`. */
export type PublicMedia = {
  id: string;
  url: string;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  is_primary?: boolean;
  position?: number;
  file_type?: 'image' | 'pdf';
  /** Backend mediaService.VALID_MEDIA_TYPES = interior | exterior | menu | dishes
   *  Legacy rows may also carry 'photo'. Brief 4 filters: 'menu' → MenuBlock
   *  PDF fallback; others → gallery. */
  type?: string;
  caption?: string | null;
};

/** Promotion row attached to detail projection. */
export type PublicPromotion = {
  id: string;
  title: string;
  description?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  status: string;
};

/** Review — backend `toPublicReview`. Author wrapper hides user_id leak. */
export type PublicReview = {
  id: string;
  establishment_id: string;
  rating: number;
  content: string;
  partner_response: string | null;
  partner_response_at: string | null;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
  author: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
};

/** Menu item — backend `toPublicMenuItem`. Excludes is_hidden_by_admin/sanity_flag/confidence. */
export type PublicMenuItem = {
  id: string;
  establishment_id: string;
  item_name: string;
  price_byn: number | null;
  category_raw: string | null;
  position: number;
  /**
   * Two-tier OCR quality signal (Brief 4 / CAT-C-2.7 augmentation).
   * Derived from `sanity_flag` presence at the projection layer:
   *   'clean' = sanity_flag IS NULL (passed all rules)
   *   'needs_caution' = sanity_flag IS NOT NULL (at least one rule failed)
   * Consumers render a caution indicator on 'needs_caution' items; JSON-LD
   * emitters should include ONLY 'clean' items (avoid propagating
   * potentially-incorrect prices/names to search engines).
   */
  quality_tier: 'clean' | 'needs_caution';
};

// ============================================================================
// Metadata
// ============================================================================

export type MetadataSlug = {
  slug: string;
  name: string;
};

export type PublicMetadata = {
  cities: MetadataSlug[];
  categories: MetadataSlug[];
  cuisines: MetadataSlug[];
};

// ============================================================================
// API envelope
// ============================================================================

export type ApiSuccessResponse<T> = { success: true; data: T };
export type ApiErrorResponse = {
  success: false;
  /**
   * Backend error object. `code` is the machine-readable error code
   * (e.g. 'OAUTH_EMAIL_NOT_VERIFIED', 'INVALID_TOKEN') the web tier maps to
   * user-facing messages. `statusCode` is often absent from the body — the
   * HTTP response status is the source of truth (serverFetch falls back to it).
   * `details` carries field-level validation errors on 422 VALIDATION_ERROR.
   * Shape varies by the route's validation path: routes using the shared
   * `validate` middleware (e.g. reviews) emit an ARRAY `[{field, message,
   * value}, …]` (errorHandler.js:198) — confirm the shape per endpoint. Backend
   * texts are English, so the web tier maps them to Russian per-field.
   */
  error: {
    message: string;
    statusCode?: number;
    code?: string;
    details?: unknown;
  };
};
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Typed error thrown by serverFetch when backend returns {success:false} OR
 * the response is non-conformant. Consumers should `instanceof ApiError`
 * to discriminate.
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public errorCode?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ============================================================================
// Auth — Phase B Slice 1 (web OAuth + session)
// ============================================================================

/**
 * Display-safe user summary surfaced to the client (AuthProvider / AuthMenu).
 * Derived server-side from the backend user object. NEVER carries tokens.
 */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarUrl: string | null;
};

/**
 * Backend `POST /api/v1/auth/oauth` success `data` payload (camelCase under
 * `data.*`). The request field is literally `token` (Google id_token). See
 * backend authController.oauthLogin.
 */
export type OAuthLoginData = {
  user: {
    id: string;
    email: string;
    phone: string | null;
    name: string;
    role: string;
    authMethod: string;
    avatarUrl: string | null;
    lastLoginAt: string | null;
  };
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
};

/**
 * Backend `POST /api/v1/auth/refresh` success `data` payload. Single-use
 * rotation: each call mints a NEW access+refresh pair and invalidates the old
 * refresh token. The `user` object omits avatarUrl (display fields are sourced
 * from the rg_user cookie set at login, not re-derived on refresh).
 */
export type RefreshData = {
  user: {
    id: string;
    email: string;
    phone: string | null;
    name: string;
    role: string;
  };
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
};

/**
 * Backend `POST /api/v1/auth/register` success `data` payload (201). Differs
 * from OAuthLoginData in the user object only: carries `createdAt`, omits
 * `avatarUrl` / `lastLoginAt` (fresh account — verified Slice 2 Discovery,
 * backend authController.register). registerAction widens it to the
 * OAuthLoginData shape (`avatarUrl: null, lastLoginAt: null`) before the
 * shared persistOAuthSession.
 */
export type RegisterData = {
  user: {
    id: string;
    email: string;
    phone: string | null;
    name: string;
    role: string;
    authMethod: string;
    createdAt: string;
  };
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
};

/**
 * Backend `POST /api/v1/auth/login` success `data` payload — field-for-field
 * identical to the OAuth response (verified Slice 2 Discovery), so login
 * persists through the unchanged persistOAuthSession.
 */
export type LoginData = OAuthLoginData;

/**
 * Backend `POST /api/v1/auth/forgot-password` and `POST /api/v1/auth/reset-password`
 * success `data` payloads — a generic acknowledgement. On forgot the backend
 * answers with the byte-identical body whether or not the email exists
 * (enumeration safety); the web tier shows its own fixed Russian texts and
 * never surfaces this English message.
 */
export type PasswordResetMessageData = { message: string };

// ============================================================================
// Partner cabinet — Phase C Slice 1 (Segment B)
//
// Mirrors backend partner surface (manual mirror, no codegen — keep in sync):
//   list row   → establishmentModel.getPartnerEstablishments projection
//   edit detail→ establishmentService getEstablishmentById projection
//   write echo → establishment create/update/submit controllers
//   temp media → tempMediaRoutes POST /partner/media/upload
// Source of truth: backend. On contract change, re-derive here MANUALLY.
// ============================================================================

/**
 * Establishment lifecycle status. The DB column also yields 'rejected' (the
 * submit-gate accepts {draft, rejected, suspended} — Discovery Q2), even though
 * the list query's `?status=` enum omits it; the cabinet groups by the returned
 * value, so all five are surfaced.
 */
export type EstablishmentStatus =
  | 'draft'
  | 'pending'
  | 'active'
  | 'rejected'
  | 'suspended';

/**
 * Parsed moderation notes — backend stores the column as TEXT holding a JSON
 * string and parses it to an object before returning (`{field: comment}`). A
 * `suspend_reason` key marks an ADMIN suspension; its absence on a suspended row
 * marks a self-suspension (read-only vs editable — see backend updateEstablishment
 * and feedback_admin_vs_self_suspend). Null when never moderated.
 */
export type ModerationNotes = Record<string, string> | null;

/**
 * Partner list row — getPartnerEstablishments projection (+ primary_photo
 * subselect). pg NUMERIC columns (average_rating, latitude, longitude) are
 * coerced to numbers at the backend list boundary (parity with the single-get
 * path, OSB hardening), so `number | null` below is the true wire type — not
 * a hopeful cast over a "4.50" string. Pinned by the backend
 * establishmentService list-coercion test.
 */
export type PartnerEstablishmentListing = {
  id: string;
  partner_id: string;
  name: string;
  description: string | null;
  city: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  categories: string[];
  cuisines: string[];
  price_range: string | null;
  status: EstablishmentStatus;
  subscription_tier: string | null;
  view_count: number;
  favorite_count: number;
  review_count: number;
  average_rating: number | null;
  base_score: number | null;
  moderation_notes: ModerationNotes;
  primary_photo: { url: string; thumbnail_url: string | null } | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

/** GET /partner/establishments envelope `data`. */
export type PartnerEstablishmentListResponse = {
  establishments: PartnerEstablishmentListing[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages?: number;
  };
};

/**
 * GET /partner/establishments/:id — full edit projection. Listing fields plus the
 * canonical write fields and parsed media URL arrays. `menu_photos` mixes menu
 * IMAGE and PDF urls (both stored type='menu') — Segment B Commit 4 separates
 * them for edit hydration. Legal fields are read-only here (no step 6 in slice).
 */
export type PartnerEstablishmentDetail = PartnerEstablishmentListing & {
  slug: string | null;
  working_hours: unknown;
  special_hours: unknown;
  attributes: Record<string, boolean> | null;
  interior_photos: string[];
  menu_photos: string[];
  legal_name: string | null;
  unp: string | null;
  contact_person: string | null;
  contact_email: string | null;
};

/** Minimal write echo we consume from create/update/submit (backend returns more). */
export type EstablishmentWriteResult = {
  id: string;
  status?: EstablishmentStatus;
  base_score?: number | null;
  slug?: string | null;
};

/** Temp-upload response — tempMediaRoutes (uniform for image & PDF paths). */
export type TempMediaResponse = {
  url: string;
  thumbnail_url: string;
  preview_url: string;
  public_id: string;
  file_type: 'image' | 'pdf';
};

/**
 * menu_pdfs[] entry in the create payload — temp-upload fields + file_name. The
 * temp response omits file_name, so the web supplies it from the uploaded File.
 */
export type MenuPdfPayload = {
  url: string;
  thumbnail_url: string;
  preview_url: string;
  file_name: string;
};

/** Canonical per-day working hours (Q10). Midnight = '00:00' (2-digit). */
export type DayHours =
  | { is_open: false }
  | { is_open: true; open: string; close: string };

export type WorkingHoursPayload = Record<string, DayHours>;

/**
 * POST /partner/establishments body — mirrors partner_registration.dart toJson
 * (the эталон) MINUS the legal step-6 fields (D1 zero — no legal data in this
 * slice). categories/cuisines/city are Cyrillic canon strings (Decision 2).
 */
export type CreateEstablishmentPayload = {
  name: string;
  description?: string;
  categories: string[];
  cuisines: string[];
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  working_hours: WorkingHoursPayload;
  phone?: string;
  email?: string;
  website?: string;
  price_range?: string;
  attributes?: Record<string, boolean>;
  interior_photos?: string[];
  menu_photos?: string[];
  menu_pdfs?: MenuPdfPayload[];
  primary_photo?: string;
};

/**
 * PUT /partner/establishments/:id body — all optional; image media-sync via
 * interior_photos/menu_photos arrays (delete-missing/insert-new). menu_pdfs are
 * NOT processed by PUT (asymmetry Q1 — PDFs post-create go via POST /:id/media).
 */
export type UpdateEstablishmentPayload = Partial<
  Omit<CreateEstablishmentPayload, 'menu_pdfs'>
>;
