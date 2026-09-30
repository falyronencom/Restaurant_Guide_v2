/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: bookingService.js
 *
 * Tests booking lifecycle: create, confirm, decline, cancel, no-show, complete.
 * Validates: user limits, working hours, time constraints, status transitions,
 * partner ownership.
 *
 * Since 30.09.2026 the date and time arithmetic of createBooking runs in SQL on
 * the Minsk clock (BookingModel.checkSlot). Here the slot reading is mocked and
 * the tests check the decisions the service takes on it; the arithmetic itself
 * is proven against the real database, under both process zones, in
 * integration/bookings-create-time.test.js.
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Mocks
// ============================================================================

jest.unstable_mockModule('../../models/bookingModel.js', () => ({
  checkSlot: jest.fn(),
  create: jest.fn(),
  getById: jest.fn(),
  updateStatus: jest.fn(),
  getByEstablishmentId: jest.fn(),
  getByUserId: jest.fn(),
  getActiveCountForUser: jest.fn(),
  getActiveForEstablishmentAndUser: jest.fn(),
}));

jest.unstable_mockModule('../../models/bookingSettingsModel.js', () => ({
  getByEstablishmentId: jest.fn(),
}));

jest.unstable_mockModule('../../models/establishmentModel.js', () => ({
  findEstablishmentById: jest.fn(() => Promise.resolve(null)),
  checkOwnership: jest.fn(),
}));

jest.unstable_mockModule('../../models/partnerAnalyticsModel.js', () => ({
  trackBookingRequest: jest.fn(() => Promise.resolve()),
  trackBookingConfirmed: jest.fn(() => Promise.resolve()),
}));

jest.unstable_mockModule('../../services/notificationService.js', () => ({
  notifyBookingReceived: jest.fn(() => Promise.resolve()),
  notifyBookingConfirmed: jest.fn(() => Promise.resolve()),
  notifyBookingDeclined: jest.fn(() => Promise.resolve()),
  notifyBookingExpired: jest.fn(() => Promise.resolve()),
  notifyBookingCancelled: jest.fn(() => Promise.resolve()),
}));

jest.unstable_mockModule('../../middleware/errorHandler.js', () => ({
  AppError: class AppError extends Error {
    constructor(message, statusCode, code) {
      super(message);
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

// Import after mocking
const BookingModel = await import('../../models/bookingModel.js');
const BookingSettingsModel = await import('../../models/bookingSettingsModel.js');
const EstablishmentModel = await import('../../models/establishmentModel.js');
const AnalyticsModel = await import('../../models/partnerAnalyticsModel.js');
const NotificationService = await import('../../services/notificationService.js');
await import('../../middleware/errorHandler.js');

const {
  createBooking,
  confirmBooking,
  declineBooking,
  cancelBooking,
  markNoShow,
  markCompleted,
  getPartnerBookings,
  getUserBookings,
} = await import('../../services/bookingService.js');

// ============================================================================
// Helpers
// ============================================================================

const USER_ID = uuidv4();
const PARTNER_ID = uuidv4();
const EST_ID = uuidv4();
const BOOKING_ID = uuidv4();

const mockEstablishment = {
  id: EST_ID,
  partner_id: PARTNER_ID,
  name: 'Test Restaurant',
  status: 'active',
  working_hours: {
    monday: '09:00-22:00',
    tuesday: '09:00-22:00',
    wednesday: '09:00-22:00',
    thursday: '09:00-22:00',
    friday: '09:00-23:00',
    saturday: { is_open: true, open: '10:00', close: '23:00' },
    sunday: { is_open: false },
  },
};

const mockSettings = {
  establishment_id: EST_ID,
  is_enabled: true,
  max_guests_per_booking: 10,
  confirmation_timeout_hours: 4,
  max_days_ahead: 7,
  min_hours_before: 2,
};

// The date is only passed through: where it sits against "now" is the mocked
// slot reading below (BookingModel.checkSlot), not local JS date arithmetic.
const validBookingData = () => ({
  establishmentId: EST_ID,
  date: '2026-10-05',
  time: '12:00',
  guestCount: 2,
  comment: 'Window table please',
  contactPhone: '+375291234567',
});

/** A slot two days ahead on a Monday (working_hours.monday = 09:00-22:00). */
const VALID_SLOT = { isPastDate: false, isTooFar: false, dayOfWeek: 1, hoursUntil: 48 };

const mockBooking = {
  id: BOOKING_ID,
  establishment_id: EST_ID,
  user_id: USER_ID,
  booking_date: '2026-04-10',
  booking_time: '12:00',
  guest_count: 2,
  status: 'pending',
  establishment_name: 'Test Restaurant',
};

beforeEach(() => {
  jest.clearAllMocks();
  // Re-set mocks that return Promises (cleared by clearAllMocks)
  AnalyticsModel.trackBookingRequest.mockImplementation(() => Promise.resolve());
  AnalyticsModel.trackBookingConfirmed.mockImplementation(() => Promise.resolve());
  NotificationService.notifyBookingReceived.mockImplementation(() => Promise.resolve());
  NotificationService.notifyBookingConfirmed.mockImplementation(() => Promise.resolve());
  NotificationService.notifyBookingDeclined.mockImplementation(() => Promise.resolve());
  NotificationService.notifyBookingExpired.mockImplementation(() => Promise.resolve());
  NotificationService.notifyBookingCancelled.mockImplementation(() => Promise.resolve());
  // The partner owns EST_ID unless a test says otherwise.
  EstablishmentModel.checkOwnership.mockResolvedValue(true);
  BookingModel.checkSlot.mockResolvedValue(VALID_SLOT);
});

// ============================================================================
// createBooking
// ============================================================================

describe('createBooking', () => {
  it('creates booking with valid data', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(mockSettings);
    BookingModel.getActiveCountForUser.mockResolvedValue(0);
    BookingModel.getActiveForEstablishmentAndUser.mockResolvedValue(null);
    BookingModel.create.mockResolvedValue({ id: BOOKING_ID, ...validBookingData(), status: 'pending' });

    const result = await createBooking(USER_ID, validBookingData());

    expect(result.id).toBe(BOOKING_ID);
    expect(BookingModel.checkSlot).toHaveBeenCalledWith({
      bookingDate: '2026-10-05', bookingTime: '12:00', maxDaysAhead: 7, now: null,
    });
    // The deadline is computed in SQL from the timeout, not handed over as a
    // JS Date (which a zone-less column would store as the process wall clock).
    expect(BookingModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ confirmationTimeoutHours: 4, now: null }),
    );
    expect(BookingModel.create.mock.calls[0][0]).not.toHaveProperty('expiresAt');
    expect(AnalyticsModel.trackBookingRequest).toHaveBeenCalledWith(EST_ID);
    expect(NotificationService.notifyBookingReceived).toHaveBeenCalled();
  });

  it('passes the injected clock to the slot reading and to the insert', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(mockSettings);
    BookingModel.getActiveCountForUser.mockResolvedValue(0);
    BookingModel.getActiveForEstablishmentAndUser.mockResolvedValue(null);
    BookingModel.create.mockResolvedValue({ id: BOOKING_ID });
    const now = new Date('2026-09-23T21:30:00Z');

    await createBooking(USER_ID, validBookingData(), { now });

    expect(BookingModel.checkSlot).toHaveBeenCalledWith(expect.objectContaining({ now }));
    expect(BookingModel.create).toHaveBeenCalledWith(expect.objectContaining({ now }));
  });

  it.each([
    ['time without a leading zero', { time: '9:00' }],
    ['hour 24', { time: '24:00' }],
    ['day that does not exist', { date: '2026-02-30' }],
    ['not a date', { date: 'завтра' }],
  ])('rejects %s before reading the database', async (_label, override) => {
    await expect(createBooking(USER_ID, { ...validBookingData(), ...override }))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(EstablishmentModel.findEstablishmentById).not.toHaveBeenCalled();
    expect(BookingModel.checkSlot).not.toHaveBeenCalled();
  });

  it('rejects when establishment not found', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

    await expect(createBooking(USER_ID, validBookingData()))
      .rejects.toThrow('Заведение не найдено');
  });

  it('rejects when booking not enabled', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue({ ...mockSettings, is_enabled: false });

    await expect(createBooking(USER_ID, validBookingData()))
      .rejects.toThrow('Бронирование недоступно');
  });

  it('rejects when guest count exceeds max', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(mockSettings);

    const data = { ...validBookingData(), guestCount: 20 };
    await expect(createBooking(USER_ID, data))
      .rejects.toThrow('Количество гостей должно быть');
  });

  it('rejects when the slot reading says the date is in the past', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(mockSettings);
    BookingModel.checkSlot.mockResolvedValue({ ...VALID_SLOT, isPastDate: true, hoursUntil: -12 });

    await expect(createBooking(USER_ID, validBookingData()))
      .rejects.toMatchObject({ code: 'INVALID_DATE', message: expect.stringContaining('в прошлом') });
  });

  it('rejects when the slot reading says the date exceeds max_days_ahead', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(mockSettings);
    BookingModel.checkSlot.mockResolvedValue({ ...VALID_SLOT, isTooFar: true });

    await expect(createBooking(USER_ID, validBookingData()))
      .rejects.toMatchObject({ code: 'DATE_TOO_FAR', message: expect.stringContaining('дней вперёд') });
  });

  it('rejects when establishment closed on the slot weekday (object format)', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(mockSettings);
    // Sunday (0) is { is_open: false } in mockEstablishment
    BookingModel.checkSlot.mockResolvedValue({ ...VALID_SLOT, dayOfWeek: 0 });

    await expect(createBooking(USER_ID, validBookingData()))
      .rejects.toMatchObject({ code: 'CLOSED_DAY' });
  });

  it('rejects when time outside working hours', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(mockSettings);

    const data = { ...validBookingData(), time: '23:30' };
    await expect(createBooking(USER_ID, data))
      .rejects.toMatchObject({ code: 'TIME_OUTSIDE_HOURS', message: expect.stringContaining('в рабочие часы') });
  });

  it('rejects when fewer than min_hours_before remain until the slot', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(mockSettings);
    BookingModel.checkSlot.mockResolvedValue({ ...VALID_SLOT, hoursUntil: 1.99 });

    await expect(createBooking(USER_ID, validBookingData()))
      .rejects.toMatchObject({ code: 'TOO_LATE' });
  });

  it('rejects when user has 2 active bookings', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(mockSettings);
    BookingModel.getActiveCountForUser.mockResolvedValue(2);

    await expect(createBooking(USER_ID, validBookingData()))
      .rejects.toThrow('2 активных бронирования');
  });

  it('rejects duplicate booking at same establishment', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
    BookingSettingsModel.getByEstablishmentId.mockResolvedValue(mockSettings);
    BookingModel.getActiveCountForUser.mockResolvedValue(1);
    BookingModel.getActiveForEstablishmentAndUser.mockResolvedValue({ id: 'existing' });

    await expect(createBooking(USER_ID, validBookingData()))
      .rejects.toThrow('активное бронирование в этом заведении');
  });

  it('rejects when required fields missing', async () => {
    await expect(createBooking(USER_ID, { establishmentId: EST_ID }))
      .rejects.toThrow('обязательные поля');
  });
});

// ============================================================================
// confirmBooking
// ============================================================================

describe('confirmBooking', () => {
  it('confirms a pending booking', async () => {
    BookingModel.getById.mockResolvedValue({ ...mockBooking, status: 'pending' });
    BookingModel.updateStatus.mockResolvedValue({ ...mockBooking, status: 'confirmed' });

    const result = await confirmBooking(BOOKING_ID, PARTNER_ID, EST_ID);

    expect(result.status).toBe('confirmed');
    expect(BookingModel.updateStatus).toHaveBeenCalledWith(
      BOOKING_ID,
      expect.objectContaining({ status: 'confirmed' }),
    );
    expect(AnalyticsModel.trackBookingConfirmed).toHaveBeenCalledWith(EST_ID);
    expect(NotificationService.notifyBookingConfirmed).toHaveBeenCalled();
  });

  it('rejects confirming non-pending booking', async () => {
    BookingModel.getById.mockResolvedValue({ ...mockBooking, status: 'confirmed' });

    await expect(confirmBooking(BOOKING_ID, PARTNER_ID, EST_ID))
      .rejects.toThrow("Cannot confirm booking with status 'confirmed'");
  });

  it('rejects when booking not found', async () => {
    BookingModel.getById.mockResolvedValue(null);

    await expect(confirmBooking(BOOKING_ID, PARTNER_ID, EST_ID))
      .rejects.toThrow('Booking not found');
  });

  it('rejects when booking belongs to different establishment', async () => {
    BookingModel.getById.mockResolvedValue({ ...mockBooking, establishment_id: 'other-est' });

    await expect(confirmBooking(BOOKING_ID, PARTNER_ID, EST_ID))
      .rejects.toThrow('does not belong');
  });
});

// ============================================================================
// declineBooking
// ============================================================================

describe('declineBooking', () => {
  it('declines a pending booking with reason', async () => {
    BookingModel.getById.mockResolvedValue({ ...mockBooking, status: 'pending' });
    BookingModel.updateStatus.mockResolvedValue({ ...mockBooking, status: 'declined' });

    const result = await declineBooking(BOOKING_ID, PARTNER_ID, EST_ID, 'Fully booked');

    expect(result.status).toBe('declined');
    expect(BookingModel.updateStatus).toHaveBeenCalledWith(
      BOOKING_ID,
      expect.objectContaining({ status: 'declined', declineReason: 'Fully booked' }),
    );
    expect(NotificationService.notifyBookingDeclined).toHaveBeenCalled();
  });

  it('rejects decline without reason', async () => {
    await expect(declineBooking(BOOKING_ID, PARTNER_ID, EST_ID, ''))
      .rejects.toThrow('Decline reason is required');
  });

  it('rejects declining non-pending booking', async () => {
    BookingModel.getById.mockResolvedValue({ ...mockBooking, status: 'confirmed' });

    await expect(declineBooking(BOOKING_ID, PARTNER_ID, EST_ID, 'reason'))
      .rejects.toThrow("Cannot decline booking with status 'confirmed'");
  });
});

// ============================================================================
// cancelBooking
// ============================================================================

describe('cancelBooking', () => {
  it('cancels a confirmed booking by user', async () => {
    BookingModel.getById.mockResolvedValue({ ...mockBooking, status: 'confirmed', user_id: USER_ID });
    BookingModel.updateStatus.mockResolvedValue({ ...mockBooking, status: 'cancelled' });
    EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);

    const result = await cancelBooking(BOOKING_ID, USER_ID);

    expect(result.status).toBe('cancelled');
    expect(NotificationService.notifyBookingCancelled).toHaveBeenCalled();
  });

  it('rejects cancel by different user', async () => {
    BookingModel.getById.mockResolvedValue({ ...mockBooking, status: 'confirmed', user_id: 'other-user' });

    await expect(cancelBooking(BOOKING_ID, USER_ID))
      .rejects.toThrow('does not belong to you');
  });

  it('rejects cancelling non-confirmed booking', async () => {
    BookingModel.getById.mockResolvedValue({ ...mockBooking, status: 'pending', user_id: USER_ID });

    await expect(cancelBooking(BOOKING_ID, USER_ID))
      .rejects.toThrow("Cannot cancel booking with status 'pending'");
  });
});

// ============================================================================
// markNoShow
// ============================================================================

describe('markNoShow', () => {
  it('marks confirmed booking as no-show', async () => {
    BookingModel.getById.mockResolvedValue({ ...mockBooking, status: 'confirmed' });
    BookingModel.updateStatus.mockResolvedValue({ ...mockBooking, status: 'no_show' });

    const result = await markNoShow(BOOKING_ID, PARTNER_ID, EST_ID);
    expect(result.status).toBe('no_show');
  });

  it('rejects no-show for non-confirmed booking', async () => {
    BookingModel.getById.mockResolvedValue({ ...mockBooking, status: 'pending' });

    await expect(markNoShow(BOOKING_ID, PARTNER_ID, EST_ID))
      .rejects.toThrow("Cannot mark no-show for booking with status 'pending'");
  });
});

// ============================================================================
// markCompleted
// ============================================================================

describe('markCompleted', () => {
  it('marks confirmed booking as completed', async () => {
    BookingModel.getById.mockResolvedValue({ ...mockBooking, status: 'confirmed' });
    BookingModel.updateStatus.mockResolvedValue({ ...mockBooking, status: 'completed' });

    const result = await markCompleted(BOOKING_ID, PARTNER_ID, EST_ID);
    expect(result.status).toBe('completed');
  });

  it('rejects completing non-confirmed booking', async () => {
    BookingModel.getById.mockResolvedValue({ ...mockBooking, status: 'declined' });

    await expect(markCompleted(BOOKING_ID, PARTNER_ID, EST_ID))
      .rejects.toThrow("Cannot complete booking with status 'declined'");
  });
});

// ============================================================================
// Read operations
// ============================================================================

describe('getPartnerBookings', () => {
  it('checks ownership, then delegates to BookingModel.getByEstablishmentId', async () => {
    BookingModel.getByEstablishmentId.mockResolvedValue({ items: [], total: 0 });

    const result = await getPartnerBookings(EST_ID, PARTNER_ID, { status: 'pending' });

    expect(result).toEqual({ items: [], total: 0 });
    expect(EstablishmentModel.checkOwnership).toHaveBeenCalledWith(EST_ID, PARTNER_ID);
    expect(BookingModel.getByEstablishmentId).toHaveBeenCalledWith(EST_ID, { status: 'pending' });
  });
});

// ============================================================================
// Partner ownership — checked first, before the booking is looked up
// ============================================================================

describe('a partner who does not own the establishment', () => {
  const FORBIDDEN = { statusCode: 403, code: 'FORBIDDEN' };

  beforeEach(() => {
    EstablishmentModel.checkOwnership.mockResolvedValue(false);
    BookingModel.getById.mockResolvedValue({ ...mockBooking, status: 'pending' });
  });

  it.each([
    ['confirmBooking', () => confirmBooking(BOOKING_ID, PARTNER_ID, EST_ID)],
    ['declineBooking', () => declineBooking(BOOKING_ID, PARTNER_ID, EST_ID, 'Fully booked')],
    // No reason: the ownership refusal still comes first, not the 400 for it.
    ['declineBooking without a reason', () => declineBooking(BOOKING_ID, PARTNER_ID, EST_ID, '')],
    ['markNoShow', () => markNoShow(BOOKING_ID, PARTNER_ID, EST_ID)],
    ['markCompleted', () => markCompleted(BOOKING_ID, PARTNER_ID, EST_ID)],
  ])('%s → 403 before the booking is even looked up', async (_label, act) => {
    await expect(act()).rejects.toMatchObject(FORBIDDEN);

    expect(EstablishmentModel.checkOwnership).toHaveBeenCalledWith(EST_ID, PARTNER_ID);
    expect(BookingModel.getById).not.toHaveBeenCalled();
    expect(BookingModel.updateStatus).not.toHaveBeenCalled();
    expect(NotificationService.notifyBookingConfirmed).not.toHaveBeenCalled();
    expect(NotificationService.notifyBookingDeclined).not.toHaveBeenCalled();
  });

  it('getPartnerBookings → 403, the model (and its lazy expiry) is never reached', async () => {
    await expect(getPartnerBookings(EST_ID, PARTNER_ID, {})).rejects.toMatchObject(FORBIDDEN);

    expect(BookingModel.getByEstablishmentId).not.toHaveBeenCalled();
  });
});

describe('getUserBookings', () => {
  it('delegates to BookingModel.getByUserId', async () => {
    BookingModel.getByUserId.mockResolvedValue([]);

    const result = await getUserBookings(USER_ID);

    expect(result).toEqual([]);
    expect(BookingModel.getByUserId).toHaveBeenCalledWith(USER_ID);
  });
});
