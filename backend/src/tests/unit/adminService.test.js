/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: adminService.js
 *
 * Inter-Horizon Audit Phase 3 Category B Task Brief #4 — fills the unit-test
 * coverage gap for the largest backend service (1288 LOC). Companion to
 * existing integration tests in admin-*.test.js — focuses on edge cases,
 * side-effect verification at service boundary, and error paths not exercised
 * at HTTP level.
 *
 * Tier 1 (must-cover): transactional methods, methods with multi-table side
 * effects, status-transition methods, Component 8 menu-item moderation.
 * Tier 2 (should-cover): JSON-parse normalization, search edge cases.
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Mocks (must be set up before service import)
// ============================================================================

jest.unstable_mockModule('../../models/establishmentModel.js', () => ({
  findEstablishmentById: jest.fn(),
  getPendingEstablishments: jest.fn(),
  countPendingEstablishments: jest.fn(),
  moderateEstablishment: jest.fn(),
  changeEstablishmentStatus: jest.fn(),
  getActiveEstablishments: jest.fn(),
  countActiveEstablishments: jest.fn(),
  getSuspendedEstablishments: jest.fn(),
  countSuspendedEstablishments: jest.fn(),
  searchAllEstablishments: jest.fn(),
  countSearchResults: jest.fn(),
  updateEstablishment: jest.fn(),
  claimEstablishment: jest.fn(),
}));

jest.unstable_mockModule('../../models/mediaModel.js', () => ({
  getEstablishmentMedia: jest.fn(),
  getPdfMediaByEstablishment: jest.fn(),
}));

jest.unstable_mockModule('../../models/menuItemModel.js', () => ({
  findById: jest.fn(),
  updateById: jest.fn(),
  getFlaggedItems: jest.fn(),
}));

jest.unstable_mockModule('../../models/ocrJobModel.js', () => ({
  hasCompletedJobForMedia: jest.fn(),
  enqueue: jest.fn(),
}));

jest.unstable_mockModule('../../models/partnerDocumentsModel.js', () => ({
  findByEstablishmentId: jest.fn(),
}));

jest.unstable_mockModule('../../models/auditLogModel.js', () => ({
  createAuditLog: jest.fn(),
  getRejectionHistory: jest.fn(),
  countRejections: jest.fn(),
}));

jest.unstable_mockModule('../../services/notificationService.js', () => ({
  notifyEstablishmentStatusChange: jest.fn(),
  notifyEstablishmentClaimed: jest.fn(),
}));

jest.unstable_mockModule('../../services/establishmentService.js', () => ({
  BELARUS_BOUNDS: {
    LAT_MIN: 51.0,
    LAT_MAX: 56.5,
    LON_MIN: 23.0,
    LON_MAX: 33.0,
  },
  CITY_BOUNDS: {},
  validateCityCoordinates: jest.fn(),
}));

jest.unstable_mockModule('../../services/authService.js', () => ({
  upgradeUserToPartner: jest.fn(),
}));

jest.unstable_mockModule('../../config/database.js', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

jest.unstable_mockModule('../../middleware/errorHandler.js', () => ({
  AppError: class AppError extends Error {
    constructor(message, statusCode, code) {
      super(message);
      this.name = 'AppError';
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ============================================================================
// Imports (after mocking)
// ============================================================================

const EstablishmentModel = await import('../../models/establishmentModel.js');
const MediaModel = await import('../../models/mediaModel.js');
const MenuItemModel = await import('../../models/menuItemModel.js');
const OcrJobModel = await import('../../models/ocrJobModel.js');
const PartnerDocumentsModel = await import('../../models/partnerDocumentsModel.js');
const AuditLogModel = await import('../../models/auditLogModel.js');
const NotificationService = await import('../../services/notificationService.js');
const EstablishmentService = await import('../../services/establishmentService.js');
const AuthService = await import('../../services/authService.js');
const DB = await import('../../config/database.js');

const {
  moderateEstablishment,
  suspendEstablishment,
  unsuspendEstablishment,
  claimEstablishment,
  adminUpgradeUserToPartner,
  updateEstablishmentCoordinates,
  searchUsers,
} = await import('../../services/adminService.js');

// ============================================================================
// Helpers + Fixtures
// ============================================================================

const ADMIN_ID = uuidv4();
const EST_ID = uuidv4();
const PARTNER_ID = uuidv4();
const TARGET_USER_ID = uuidv4();

// Drains pending microtasks/macrotasks — needed for fire-and-forget IIFE
// (e.g. the OCR backfill block in moderateEstablishment is not awaited)
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const buildMockClient = () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  release: jest.fn(),
});

const buildReq = () => ({
  ip: '127.0.0.1',
  get: jest.fn((header) => (header === 'User-Agent' ? 'TestAgent/1.0' : null)),
});

const baseEstablishment = (overrides = {}) => ({
  id: EST_ID,
  partner_id: PARTNER_ID,
  name: 'Тестовое заведение',
  status: 'pending',
  city: 'Минск',
  address: 'Test address',
  latitude: '53.9',
  longitude: '27.5667',
  moderation_notes: null,
  published_at: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

beforeEach(() => {
  // jest.config has resetMocks:true — re-set Promise-returning mocks per test.
  AuditLogModel.createAuditLog.mockResolvedValue(undefined);
  NotificationService.notifyEstablishmentStatusChange.mockResolvedValue(undefined);
  NotificationService.notifyEstablishmentClaimed.mockResolvedValue(undefined);
  MediaModel.getPdfMediaByEstablishment.mockResolvedValue([]);
  MediaModel.getEstablishmentMedia.mockResolvedValue([]);
  PartnerDocumentsModel.findByEstablishmentId.mockResolvedValue(null);
  OcrJobModel.hasCompletedJobForMedia.mockResolvedValue(false);
  OcrJobModel.enqueue.mockResolvedValue(undefined);
  EstablishmentService.validateCityCoordinates.mockReturnValue({ valid: true });
});

// ============================================================================
// moderateEstablishment — Tier 1
// ============================================================================

describe('moderateEstablishment', () => {
  const baseParams = {
    action: 'approve',
    moderation_notes: {},
    adminUserId: ADMIN_ID,
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
  };

  test('rejects unknown action with INVALID_MODERATION_ACTION', async () => {
    await expect(
      moderateEstablishment(EST_ID, { ...baseParams, action: 'delete' }),
    ).rejects.toMatchObject({
      code: 'INVALID_MODERATION_ACTION',
      statusCode: 400,
    });
    expect(EstablishmentModel.findEstablishmentById).not.toHaveBeenCalled();
  });

  test('throws ESTABLISHMENT_NOT_FOUND when establishment is missing', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(null);
    await expect(moderateEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'ESTABLISHMENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  test('rejects with INVALID_STATUS_FOR_MODERATION when status is not pending', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    await expect(moderateEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'INVALID_STATUS_FOR_MODERATION',
      statusCode: 400,
    });
  });

  test('approve transitions status to active with setPublishedAt=true', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );

    const result = await moderateEstablishment(EST_ID, { ...baseParams, action: 'approve' });
    await flushPromises();

    expect(result.status).toBe('active');
    expect(EstablishmentModel.moderateEstablishment).toHaveBeenCalledWith(
      EST_ID,
      expect.objectContaining({
        status: 'active',
        moderated_by: ADMIN_ID,
        setPublishedAt: true,
      }),
    );
  });

  test('reject transitions status to rejected and propagates moderation_notes', async () => {
    const notes = { name: 'Misleading name', description: 'Too vague' };
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'rejected' }),
    );

    const result = await moderateEstablishment(EST_ID, {
      ...baseParams,
      action: 'reject',
      moderation_notes: notes,
    });

    expect(result.status).toBe('rejected');
    expect(EstablishmentModel.moderateEstablishment).toHaveBeenCalledWith(
      EST_ID,
      expect.objectContaining({
        status: 'rejected',
        moderation_notes: notes,
        setPublishedAt: false,
      }),
    );
  });

  test('approve writes audit_log entry with action=moderate_approve', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );

    await moderateEstablishment(EST_ID, { ...baseParams, action: 'approve' });
    await flushPromises();

    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ADMIN_ID,
        action: 'moderate_approve',
        entity_type: 'establishment',
        entity_id: EST_ID,
        old_data: { status: 'pending' },
        new_data: expect.objectContaining({ status: 'active' }),
        ip_address: '127.0.0.1',
        user_agent: 'TestAgent/1.0',
      }),
    );
  });

  test('reject writes audit_log entry with action=moderate_reject and notes', async () => {
    const notes = { description: 'unclear' };
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'rejected' }),
    );

    await moderateEstablishment(EST_ID, {
      ...baseParams,
      action: 'reject',
      moderation_notes: notes,
    });

    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'moderate_reject',
        new_data: { status: 'rejected', moderation_notes: notes },
      }),
    );
  });

  test('approve notifies partner without rejection reason (null)', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );

    await moderateEstablishment(EST_ID, { ...baseParams, action: 'approve' });
    await flushPromises();

    expect(NotificationService.notifyEstablishmentStatusChange).toHaveBeenCalledWith(
      EST_ID,
      'active',
      null,
    );
  });

  test('reject notifies partner with moderation_notes as third argument', async () => {
    const notes = { name: 'incorrect' };
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'rejected' }),
    );

    await moderateEstablishment(EST_ID, {
      ...baseParams,
      action: 'reject',
      moderation_notes: notes,
    });

    expect(NotificationService.notifyEstablishmentStatusChange).toHaveBeenCalledWith(
      EST_ID,
      'rejected',
      notes,
    );
  });

  test('throws MODERATION_CONFLICT when Model.moderateEstablishment returns null', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(null);

    await expect(moderateEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'MODERATION_CONFLICT',
      statusCode: 409,
    });
  });

  test('approve enqueues OCR jobs for PDFs without completed job', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    const pdf1 = { id: uuidv4() };
    const pdf2 = { id: uuidv4() };
    MediaModel.getPdfMediaByEstablishment.mockResolvedValue([pdf1, pdf2]);
    OcrJobModel.hasCompletedJobForMedia.mockResolvedValue(false);

    await moderateEstablishment(EST_ID, { ...baseParams, action: 'approve' });
    await flushPromises();

    expect(OcrJobModel.enqueue).toHaveBeenCalledTimes(2);
    expect(OcrJobModel.enqueue).toHaveBeenCalledWith({
      establishmentId: EST_ID,
      mediaId: pdf1.id,
    });
    expect(OcrJobModel.enqueue).toHaveBeenCalledWith({
      establishmentId: EST_ID,
      mediaId: pdf2.id,
    });
  });

  test('approve skips OCR enqueue for PDFs with completed job (idempotency)', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    const pdfDone = { id: uuidv4() };
    const pdfPending = { id: uuidv4() };
    MediaModel.getPdfMediaByEstablishment.mockResolvedValue([pdfDone, pdfPending]);
    OcrJobModel.hasCompletedJobForMedia
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await moderateEstablishment(EST_ID, { ...baseParams, action: 'approve' });
    await flushPromises();

    expect(OcrJobModel.enqueue).toHaveBeenCalledTimes(1);
    expect(OcrJobModel.enqueue).toHaveBeenCalledWith({
      establishmentId: EST_ID,
      mediaId: pdfPending.id,
    });
  });

  test('wraps unexpected errors as MODERATION_FAILED 500', async () => {
    EstablishmentModel.findEstablishmentById.mockRejectedValue(new Error('DB connection lost'));

    await expect(moderateEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'MODERATION_FAILED',
      statusCode: 500,
    });
  });
});

// ============================================================================
// suspendEstablishment — Tier 1
// ============================================================================

describe('suspendEstablishment', () => {
  const baseParams = {
    reason: 'Violates community guidelines',
    adminUserId: ADMIN_ID,
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
  };

  test('rejects when reason is undefined', async () => {
    await expect(
      suspendEstablishment(EST_ID, { ...baseParams, reason: undefined }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED', statusCode: 400 });
    expect(EstablishmentModel.findEstablishmentById).not.toHaveBeenCalled();
  });

  test('rejects when reason is whitespace only', async () => {
    await expect(
      suspendEstablishment(EST_ID, { ...baseParams, reason: '   ' }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED', statusCode: 400 });
  });

  test('throws ESTABLISHMENT_NOT_FOUND when establishment is missing', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(null);
    await expect(suspendEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'ESTABLISHMENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  test('rejects with INVALID_STATUS_FOR_SUSPEND when status is not active', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'pending' }),
    );
    await expect(suspendEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'INVALID_STATUS_FOR_SUSPEND',
      statusCode: 400,
    });
  });

  test('suspends active establishment and merges reason into empty moderation_notes', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active', moderation_notes: null }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );

    const result = await suspendEstablishment(EST_ID, baseParams);

    expect(result.status).toBe('suspended');
    expect(EstablishmentModel.changeEstablishmentStatus).toHaveBeenCalledWith(
      EST_ID,
      expect.objectContaining({
        fromStatus: 'active',
        toStatus: 'suspended',
        moderationNotes: expect.objectContaining({
          suspend_reason: baseParams.reason,
          suspended_at: expect.any(String),
        }),
      }),
    );
  });

  test('preserves existing string-encoded moderation_notes when merging suspend reason', async () => {
    const existingNotes = JSON.stringify({ description: 'old comment' });
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active', moderation_notes: existingNotes }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );

    await suspendEstablishment(EST_ID, baseParams);

    expect(EstablishmentModel.changeEstablishmentStatus).toHaveBeenCalledWith(
      EST_ID,
      expect.objectContaining({
        moderationNotes: expect.objectContaining({
          description: 'old comment',
          suspend_reason: baseParams.reason,
        }),
      }),
    );
  });

  test('preserves existing object moderation_notes when merging suspend reason', async () => {
    const existingNotes = { name: 'name issue' };
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active', moderation_notes: existingNotes }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );

    await suspendEstablishment(EST_ID, baseParams);

    expect(EstablishmentModel.changeEstablishmentStatus).toHaveBeenCalledWith(
      EST_ID,
      expect.objectContaining({
        moderationNotes: expect.objectContaining({
          name: 'name issue',
          suspend_reason: baseParams.reason,
        }),
      }),
    );
  });

  test('throws SUSPEND_CONFLICT when changeEstablishmentStatus returns null', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(null);

    await expect(suspendEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'SUSPEND_CONFLICT',
      statusCode: 409,
    });
  });

  test('writes audit_log entry with action=suspend and reason in new_data', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );

    await suspendEstablishment(EST_ID, baseParams);

    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ADMIN_ID,
        action: 'suspend',
        entity_type: 'establishment',
        entity_id: EST_ID,
        old_data: { status: 'active' },
        new_data: { status: 'suspended', reason: baseParams.reason },
      }),
    );
  });

  test('notifies partner with suspended status and reason', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );

    await suspendEstablishment(EST_ID, baseParams);

    expect(NotificationService.notifyEstablishmentStatusChange).toHaveBeenCalledWith(
      EST_ID,
      'suspended',
      baseParams.reason,
    );
  });
});

// ============================================================================
// unsuspendEstablishment — Tier 1
// ============================================================================

describe('unsuspendEstablishment', () => {
  const baseParams = {
    adminUserId: ADMIN_ID,
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
  };

  test('throws ESTABLISHMENT_NOT_FOUND when establishment is missing', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(null);
    await expect(unsuspendEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'ESTABLISHMENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  test('rejects with INVALID_STATUS_FOR_UNSUSPEND when status is not suspended', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    await expect(unsuspendEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'INVALID_STATUS_FOR_UNSUSPEND',
      statusCode: 400,
    });
  });

  test('reactivates suspended establishment to active', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );

    const result = await unsuspendEstablishment(EST_ID, baseParams);

    expect(result.status).toBe('active');
    expect(EstablishmentModel.changeEstablishmentStatus).toHaveBeenCalledWith(
      EST_ID,
      { fromStatus: 'suspended', toStatus: 'active' },
    );
  });

  test('writes audit_log entry with action=unsuspend', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );

    await unsuspendEstablishment(EST_ID, baseParams);

    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ADMIN_ID,
        action: 'unsuspend',
        entity_type: 'establishment',
        entity_id: EST_ID,
        old_data: { status: 'suspended' },
        new_data: { status: 'active' },
      }),
    );
  });

  test('notifies partner with distinct unsuspended type (no reason argument)', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );

    await unsuspendEstablishment(EST_ID, baseParams);

    expect(NotificationService.notifyEstablishmentStatusChange).toHaveBeenCalledWith(
      EST_ID,
      'unsuspended',
    );
  });
});

// ============================================================================
// claimEstablishment — Tier 1 (transactional)
// ============================================================================

describe('claimEstablishment', () => {
  const activeUser = { id: TARGET_USER_ID, role: 'user', is_active: true };

  test('throws ESTABLISHMENT_NOT_FOUND when establishment is missing', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'ESTABLISHMENT_NOT_FOUND', statusCode: 404 });
    expect(DB.getClient).not.toHaveBeenCalled();
  });

  test('throws ESTABLISHMENT_ARCHIVED for archived establishment', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'archived' }),
    );

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'ESTABLISHMENT_ARCHIVED', statusCode: 400 });
  });

  test('throws ALREADY_OWNED when target user already owns the establishment', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ partner_id: TARGET_USER_ID }),
    );

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'ALREADY_OWNED', statusCode: 400 });
  });

  test('throws USER_NOT_FOUND when target user does not exist', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [] });

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
    expect(DB.getClient).not.toHaveBeenCalled();
  });

  test('throws USER_INACTIVE when target user account is deactivated', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [{ ...activeUser, is_active: false }] });

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'USER_INACTIVE', statusCode: 400 });
  });

  test('completes transaction on user→partner upgrade: BEGIN, claim, UPDATE role, COMMIT', async () => {
    const updated = baseEstablishment({ partner_id: TARGET_USER_ID });
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [activeUser] });
    EstablishmentModel.claimEstablishment.mockResolvedValue(updated);
    const client = buildMockClient();
    DB.getClient.mockResolvedValue(client);

    const result = await claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq());

    expect(result).toEqual(updated);
    const queries = client.query.mock.calls.map((c) => c[0]);
    expect(queries).toContain('BEGIN');
    expect(queries).toContain('COMMIT');
    expect(queries).not.toContain('ROLLBACK');
    expect(EstablishmentModel.claimEstablishment).toHaveBeenCalledWith(
      EST_ID,
      TARGET_USER_ID,
      ADMIN_ID,
      client,
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users SET role = 'partner'"),
      [expect.any(Date), TARGET_USER_ID],
    );
    expect(client.release).toHaveBeenCalled();
  });

  test('skips role UPDATE for user already in partner role (idempotent)', async () => {
    const partnerUser = { id: TARGET_USER_ID, role: 'partner', is_active: true };
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [partnerUser] });
    EstablishmentModel.claimEstablishment.mockResolvedValue(baseEstablishment());
    const client = buildMockClient();
    DB.getClient.mockResolvedValue(client);

    await claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq());

    const updateUserCalls = client.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('UPDATE users'),
    );
    expect(updateUserCalls).toHaveLength(0);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('rolls back transaction and throws CLAIM_FAILED when claim model errors', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [activeUser] });
    EstablishmentModel.claimEstablishment.mockRejectedValue(new Error('FK violation'));
    const client = buildMockClient();
    DB.getClient.mockResolvedValue(client);

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'CLAIM_FAILED', statusCode: 500 });

    const queries = client.query.mock.calls.map((c) => c[0]);
    expect(queries).toContain('ROLLBACK');
    expect(queries).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
    expect(AuditLogModel.createAuditLog).not.toHaveBeenCalled();
    expect(NotificationService.notifyEstablishmentClaimed).not.toHaveBeenCalled();
  });

  test('always releases client even when transaction fails', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [activeUser] });
    EstablishmentModel.claimEstablishment.mockRejectedValue(new Error('boom'));
    const client = buildMockClient();
    DB.getClient.mockResolvedValue(client);

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'CLAIM_FAILED' });

    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('writes audit_log with previous and new partner_id', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [activeUser] });
    EstablishmentModel.claimEstablishment.mockResolvedValue(baseEstablishment());
    DB.getClient.mockResolvedValue(buildMockClient());

    await claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq());

    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ADMIN_ID,
        action: 'claim_establishment',
        entity_type: 'establishment',
        entity_id: EST_ID,
        old_data: { partner_id: PARTNER_ID },
        new_data: { partner_id: TARGET_USER_ID },
        ip_address: '127.0.0.1',
        user_agent: 'TestAgent/1.0',
      }),
    );
  });

  test('triggers claimed notification for the new partner', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [activeUser] });
    EstablishmentModel.claimEstablishment.mockResolvedValue(baseEstablishment());
    DB.getClient.mockResolvedValue(buildMockClient());

    await claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq());

    expect(NotificationService.notifyEstablishmentClaimed).toHaveBeenCalledWith(
      EST_ID,
      TARGET_USER_ID,
    );
  });
});

// ============================================================================
// adminUpgradeUserToPartner — Tier 1
// ============================================================================

describe('adminUpgradeUserToPartner', () => {
  test('throws USER_NOT_FOUND when target user does not exist', async () => {
    DB.query.mockResolvedValue({ rows: [] });

    await expect(
      adminUpgradeUserToPartner(TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
    expect(AuthService.upgradeUserToPartner).not.toHaveBeenCalled();
  });

  test('throws USER_INACTIVE when target user is deactivated', async () => {
    DB.query.mockResolvedValue({
      rows: [{ id: TARGET_USER_ID, role: 'user', is_active: false }],
    });

    await expect(
      adminUpgradeUserToPartner(TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'USER_INACTIVE', statusCode: 400 });
    expect(AuthService.upgradeUserToPartner).not.toHaveBeenCalled();
  });

  test('upgrades user role and writes audit_log with old_role=user', async () => {
    DB.query.mockResolvedValue({
      rows: [{ id: TARGET_USER_ID, role: 'user', is_active: true }],
    });
    AuthService.upgradeUserToPartner.mockResolvedValue({
      id: TARGET_USER_ID,
      role: 'partner',
    });

    const result = await adminUpgradeUserToPartner(TARGET_USER_ID, ADMIN_ID, buildReq());

    expect(result.role).toBe('partner');
    expect(AuthService.upgradeUserToPartner).toHaveBeenCalledWith(TARGET_USER_ID);
    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ADMIN_ID,
        action: 'upgrade_user_to_partner',
        entity_type: 'user',
        entity_id: TARGET_USER_ID,
        old_data: { role: 'user' },
        new_data: { role: 'partner' },
      }),
    );
  });

  test('still calls upgradeUserToPartner for already-partner user (idempotent)', async () => {
    DB.query.mockResolvedValue({
      rows: [{ id: TARGET_USER_ID, role: 'partner', is_active: true }],
    });
    AuthService.upgradeUserToPartner.mockResolvedValue({
      id: TARGET_USER_ID,
      role: 'partner',
    });

    await adminUpgradeUserToPartner(TARGET_USER_ID, ADMIN_ID, buildReq());

    expect(AuthService.upgradeUserToPartner).toHaveBeenCalledWith(TARGET_USER_ID);
    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        old_data: { role: 'partner' },
        new_data: { role: 'partner' },
      }),
    );
  });

  test('passes req.ip and User-Agent into audit log', async () => {
    DB.query.mockResolvedValue({
      rows: [{ id: TARGET_USER_ID, role: 'user', is_active: true }],
    });
    AuthService.upgradeUserToPartner.mockResolvedValue({
      id: TARGET_USER_ID,
      role: 'partner',
    });
    const req = buildReq();

    await adminUpgradeUserToPartner(TARGET_USER_ID, ADMIN_ID, req);

    expect(req.get).toHaveBeenCalledWith('User-Agent');
    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        ip_address: '127.0.0.1',
        user_agent: 'TestAgent/1.0',
      }),
    );
  });
});

// ============================================================================
// updateEstablishmentCoordinates — Tier 1
// ============================================================================

describe('updateEstablishmentCoordinates', () => {
  // Within mocked BELARUS_BOUNDS (LAT 51..56.5, LON 23..33)
  const validParams = {
    latitude: 53.9,
    longitude: 27.5667,
    adminUserId: ADMIN_ID,
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
  };

  test('throws ESTABLISHMENT_NOT_FOUND when establishment is missing', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

    await expect(
      updateEstablishmentCoordinates(EST_ID, validParams),
    ).rejects.toMatchObject({ code: 'ESTABLISHMENT_NOT_FOUND', statusCode: 404 });
  });

  test('throws INVALID_LATITUDE when latitude below Belarus bounds', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());

    await expect(
      updateEstablishmentCoordinates(EST_ID, { ...validParams, latitude: 50.0 }),
    ).rejects.toMatchObject({ code: 'INVALID_LATITUDE', statusCode: 422 });
  });

  test('throws INVALID_LATITUDE when latitude above Belarus bounds', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());

    await expect(
      updateEstablishmentCoordinates(EST_ID, { ...validParams, latitude: 57.0 }),
    ).rejects.toMatchObject({ code: 'INVALID_LATITUDE', statusCode: 422 });
  });

  test('throws INVALID_LONGITUDE when longitude is out of Belarus bounds', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());

    await expect(
      updateEstablishmentCoordinates(EST_ID, { ...validParams, longitude: 22.0 }),
    ).rejects.toMatchObject({ code: 'INVALID_LONGITUDE', statusCode: 422 });
  });

  test('throws COORDINATES_CITY_MISMATCH when validateCityCoordinates rejects', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentService.validateCityCoordinates.mockReturnValue({
      valid: false,
      message: 'Coordinates do not match city',
    });

    await expect(
      updateEstablishmentCoordinates(EST_ID, validParams),
    ).rejects.toMatchObject({ code: 'COORDINATES_CITY_MISMATCH', statusCode: 422 });
    expect(EstablishmentModel.updateEstablishment).not.toHaveBeenCalled();
  });

  test('updates coordinates on valid input', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    const updated = baseEstablishment({ latitude: validParams.latitude, longitude: validParams.longitude });
    EstablishmentModel.updateEstablishment.mockResolvedValue(updated);

    const result = await updateEstablishmentCoordinates(EST_ID, validParams);

    expect(result).toEqual(updated);
    expect(EstablishmentModel.updateEstablishment).toHaveBeenCalledWith(
      EST_ID,
      { latitude: validParams.latitude, longitude: validParams.longitude },
    );
  });

  test('writes audit_log with parsed old coords and new coords', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ latitude: '53.5', longitude: '27.0' }),
    );
    EstablishmentModel.updateEstablishment.mockResolvedValue(baseEstablishment());

    await updateEstablishmentCoordinates(EST_ID, validParams);

    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ADMIN_ID,
        action: 'admin_update_coordinates',
        entity_type: 'establishment',
        entity_id: EST_ID,
        old_data: { latitude: 53.5, longitude: 27.0 },
        new_data: { latitude: validParams.latitude, longitude: validParams.longitude },
      }),
    );
  });
});

// ============================================================================
// searchUsers — Tier 2 (raw SQL, no model layer)
// ============================================================================

describe('searchUsers', () => {
  test('returns empty array for queries shorter than 2 chars', async () => {
    expect(await searchUsers(null)).toEqual([]);
    expect(await searchUsers('')).toEqual([]);
    expect(await searchUsers(' ')).toEqual([]);
    expect(await searchUsers('a')).toEqual([]);
    expect(DB.query).not.toHaveBeenCalled();
  });

  test('queries users with ILIKE wildcards around trimmed query and provided limit', async () => {
    const rows = [
      { id: uuidv4(), email: 'user@example.com', name: 'Иван', role: 'user' },
    ];
    DB.query.mockResolvedValue({ rows });

    const result = await searchUsers('  Иван  ', 5);

    expect(result).toEqual(rows);
    expect(DB.query).toHaveBeenCalledWith(
      expect.stringMatching(/email ILIKE \$1.*name ILIKE \$1/s),
      ['%Иван%', 5],
    );
  });

  test('uses default limit of 10 when not provided', async () => {
    DB.query.mockResolvedValue({ rows: [] });

    await searchUsers('test');

    expect(DB.query).toHaveBeenCalledWith(
      expect.any(String),
      ['%test%', 10],
    );
  });
});
