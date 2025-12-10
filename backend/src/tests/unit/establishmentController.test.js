/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: establishmentController.js
 *
 * Verifies controller orchestration and response formatting for establishments API.
 */

import { jest } from '@jest/globals';
import {
  createMockRequest,
  createMockResponse,
} from '../mocks/helpers.js';

jest.unstable_mockModule('../../services/establishmentService.js', () => ({
  createEstablishment: jest.fn(),
  getPartnerEstablishments: jest.fn(),
  getEstablishmentById: jest.fn(),
  updateEstablishment: jest.fn(),
  submitEstablishmentForModeration: jest.fn(),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const EstablishmentService = await import('../../services/establishmentService.js');
const EstablishmentController = await import('../../controllers/establishmentController.js');

describe('establishmentController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createEstablishment uses authenticated partner and returns 201', async () => {
    const req = createMockRequest({
      body: { name: 'Test', city: 'Минск' },
      user: { userId: 'partner-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    EstablishmentService.createEstablishment.mockResolvedValue({ id: 'est-1', name: 'Test' });

    await EstablishmentController.createEstablishment(req, res, next);

    expect(EstablishmentService.createEstablishment).toHaveBeenCalledWith('partner-1', req.body);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { establishment: { id: 'est-1', name: 'Test' } },
      message: 'Establishment created successfully in draft status',
    });
  });

  test('listPartnerEstablishments forwards pagination filters', async () => {
    const req = createMockRequest({
      query: { status: 'draft', page: '2', limit: '5' },
      user: { userId: 'partner-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    EstablishmentService.getPartnerEstablishments.mockResolvedValue({
      establishments: [],
      meta: { page: 2, limit: 5, total: 0, pages: 0 },
    });

    await EstablishmentController.listPartnerEstablishments(req, res, next);

    expect(EstablishmentService.getPartnerEstablishments).toHaveBeenCalledWith('partner-1', {
      status: 'draft',
      page: 2,
      limit: 5,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        establishments: [],
        pagination: { page: 2, limit: 5, total: 0, pages: 0 },
      },
    });
  });

  test('getEstablishmentDetails returns establishment data', async () => {
    const req = createMockRequest({
      params: { id: 'est-1' },
      user: { userId: 'partner-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    EstablishmentService.getEstablishmentById.mockResolvedValue({ id: 'est-1', name: 'Test' });

    await EstablishmentController.getEstablishmentDetails(req, res, next);

    expect(EstablishmentService.getEstablishmentById).toHaveBeenCalledWith('est-1', 'partner-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { establishment: { id: 'est-1', name: 'Test' } },
    });
  });

  test('updateEstablishment delegates to service', async () => {
    const req = createMockRequest({
      params: { id: 'est-1' },
      body: { description: 'Updated' },
      user: { userId: 'partner-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    EstablishmentService.updateEstablishment.mockResolvedValue({ id: 'est-1', description: 'Updated' });

    await EstablishmentController.updateEstablishment(req, res, next);

    expect(EstablishmentService.updateEstablishment).toHaveBeenCalledWith('est-1', 'partner-1', { description: 'Updated' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { establishment: { id: 'est-1', description: 'Updated' } },
      message: 'Establishment updated successfully',
    });
  });

  test('submitForModeration returns pending status', async () => {
    const req = createMockRequest({
      params: { id: 'est-1' },
      user: { userId: 'partner-1' },
    });
    const res = createMockResponse();
    const next = jest.fn();
    EstablishmentService.submitEstablishmentForModeration.mockResolvedValue({
      id: 'est-1',
      status: 'pending',
      updated_at: '2024-01-01',
    });

    await EstablishmentController.submitForModeration(req, res, next);

    expect(EstablishmentService.submitEstablishmentForModeration).toHaveBeenCalledWith('est-1', 'partner-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        establishment: {
          id: 'est-1',
          status: 'pending',
          submitted_at: '2024-01-01',
        },
      },
      message: 'Establishment submitted for moderation review',
    });
  });
});

