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
} = await import('../../services/adminService.js');

// ============================================================================
// Helpers + Fixtures
// ============================================================================

const ADMIN_ID = uuidv4();
const EST_ID = uuidv4();
const PARTNER_ID = uuidv4();

// Drains pending microtasks/macrotasks — needed for fire-and-forget IIFE
// (e.g. the OCR backfill block in moderateEstablishment is not awaited)
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

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
