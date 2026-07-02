/**
 * Working Hours Sanity — deterministic format check for the quality-immunity monitor.
 *
 * Detects structurally broken or fully-closed working_hours WITHOUT judging
 * business plausibility. This is NOT the live open/closed calculator (that lives
 * web-side in working-hours.ts and computes wall-clock status) — it only asks
 * "is each present day entry parseable, and is the place open on any day?".
 *
 * Deliberately out of scope (per AI-ops Brick-1 directive):
 *   - Staleness: no working_hours_updated_at column exists to measure it.
 *   - Overnight spans (close <= open, e.g. "14:00-03:00"): a legitimate bar/club
 *     pattern, NOT a defect — never flagged.
 *
 * Pure functions, no I/O — unit-testable in isolation. Mirrors the two at-rest
 * formats the platform writes (see web working-hours.ts parseDayHours):
 *   - string "HH:MM-HH:MM"                    (what the seed writes; "00:00-23:59" = 24/7)
 *   - object { is_open: false }               (closed marker)
 *   - object { is_open?: true, open, close }  (explicit open/close)
 */

const DAY_KEYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

// HH:MM in 00:00–23:59; 1-or-2-digit hour (seed writes 2-digit, parser tolerates 1).
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

const isValidTime = (value) => typeof value === 'string' && TIME_RE.test(value.trim());

/**
 * Classify a single day entry.
 * @returns {'open' | 'closed' | 'malformed'}
 */
const classifyDay = (entry) => {
  if (entry === null || entry === undefined) return 'malformed';

  if (typeof entry === 'string') {
    const parts = entry.split('-');
    if (parts.length !== 2) return 'malformed';
    return isValidTime(parts[0]) && isValidTime(parts[1]) ? 'open' : 'malformed';
  }

  if (typeof entry === 'object' && !Array.isArray(entry)) {
    if (entry.is_open === false) return 'closed';
    return isValidTime(entry.open) && isValidTime(entry.close) ? 'open' : 'malformed';
  }

  return 'malformed';
};

/**
 * Check a working_hours JSONB value for structural defects.
 *
 * @param {*} workingHours - the establishments.working_hours value (jsonb → object)
 * @returns {{ malformed: boolean, allClosed: boolean }}
 *   malformed — at least one PRESENT day entry is unparseable
 *   allClosed — no present day resolves to 'open' (closed all week, or empty object)
 *
 * A missing day KEY is tolerated (not malformed) — places legitimately omit or
 * explicitly close days. Only present-but-unparseable entries count as malformed
 * (FP>FN: conservative, to avoid false alarms on valid partial weeks).
 */
export const checkWorkingHours = (workingHours) => {
  if (workingHours === null || typeof workingHours !== 'object' || Array.isArray(workingHours)) {
    return { malformed: true, allClosed: false };
  }

  let anyOpen = false;
  let anyMalformed = false;

  for (const day of DAY_KEYS) {
    if (!(day in workingHours)) continue;
    const status = classifyDay(workingHours[day]);
    if (status === 'malformed') anyMalformed = true;
    else if (status === 'open') anyOpen = true;
  }

  return { malformed: anyMalformed, allClosed: !anyOpen };
};
