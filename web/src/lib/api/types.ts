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

/** Map marker — backend `toPublicEstablishmentMapMarker`. Minimum payload. */
export type PublicEstablishmentMapMarker = {
  id: string;
  slug: string;
  name: string;
  city: string;
  city_slug: string | null;
  latitude: number | null;
  longitude: number | null;
  primary_image_url: string | null;
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
   */
  error: { message: string; statusCode?: number; code?: string };
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
