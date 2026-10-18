/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: pdfParseRunner.js — pdf-parse in a child process, on real processes.
 *
 * What the runner promises the API process: an ordinary PDF parses as before;
 * a parse that does not finish in time, or grows past its memory, ends in its
 * own process — the child is killed and the promise rejects with code
 * PDF_PARSE_LIMIT, while this process keeps running its timers; a shutdown
 * signal kills the parse at once (PDF_PARSE_ABORTED); the child starts with
 * none of the parent's secrets.
 *
 * The misbehaving children are stand-ins (src/tests/fixtures/pdfParseChildren)
 * speaking the real child's protocol; the ordinary files are built in memory
 * (utils/syntheticPdf.js) and parsed by the real child, real pdf-parse.
 */

import { EventEmitter } from 'events';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildSyntheticPdf } from '../utils/syntheticPdf.js';
import {
  CHILD_PRIORITY,
  MEMORY_SAMPLE_INTERVAL_MS,
  OUTSIDE_KILL_MEMORY_SHARE,
  PDF_PARSE_ABORTED,
  PDF_PARSE_LIMIT,
  classifyChildEnd,
  parsePdfIsolated,
  parseResidentBytes,
  readResidentBytes,
} from '../../services/ocr/pdfParseRunner.js';
import { PDF_PARSE_MEMORY_LIMIT_MB, PDF_PARSE_TIMEOUT_MS } from '../../services/ocr/pdfTextExtractor.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'pdfParseChildren');
const child = (name) => join(FIXTURES, `${name}.js`);

const PRODUCTION_LIMITS = { timeoutMs: PDF_PARSE_TIMEOUT_MS, memoryLimitMb: PDF_PARSE_MEMORY_LIMIT_MB };

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A kill is asynchronous on every platform: give the child a moment to go. */
const waitUntilGone = async (pid, ms = 3000) => {
  const until = Date.now() + ms;
  while (isAlive(pid) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !isAlive(pid);
};

/** A resident-memory reader that records the child's pid and reports nothing. */
const pidRecorder = () => {
  const pids = new Set();
  return { pids, readResident: (pid) => { pids.add(pid); return null; } };
};

describe('an ordinary PDF parses in the child as it did in the API process', () => {
  test('a heavy menu-like file — 40 pages, a 15 MB photo — under the production limits: page count and the first 20 pages of text', async () => {
    const pdf = buildSyntheticPdf({ pages: 40, linesPerPage: 50, imageBytes: 15e6 });
    expect(pdf.length).toBeGreaterThan(15e6);

    const started = Date.now();
    const result = await parsePdfIsolated(pdf, { maxPages: 20, ...PRODUCTION_LIMITS });

    expect(result.numpages).toBe(40);
    expect(result.text).toContain('Page 1 line 1: Borsch 11 rub');
    expect(result.text).toContain('Page 20 line 50: Borsch 60 rub');
    expect(result.text).not.toContain('Page 21 line');
    // No maxChars: the whole text comes back, and its length is reported.
    expect(result.textLength).toBe(result.text.length);
    expect(result.durationMs).toBeGreaterThan(0);
    // Measured 0.2 s; the bound only says the deadline is far away.
    expect(Date.now() - started).toBeLessThan(PDF_PARSE_TIMEOUT_MS / 4);
  }, 30000);

  test('a small file (under 4 KB) parses — the child\'s first and only document; handed to pdf.js as a Buffer, it would fail', async () => {
    const pdf = buildSyntheticPdf({ pages: 1, linesPerPage: 3 });

    const result = await parsePdfIsolated(pdf, { maxPages: 20, ...PRODUCTION_LIMITS });

    expect(result).toMatchObject({ numpages: 1, text: expect.stringContaining('Page 1 line 3: Borsch 13 rub') });
  }, 15000);

  test('maxChars: the child sends back that many characters and the full length — the API process gets no more', async () => {
    const pdf = buildSyntheticPdf({ pages: 20, linesPerPage: 50 });

    const whole = await parsePdfIsolated(pdf, { maxPages: 20, maxChars: 0, ...PRODUCTION_LIMITS });
    const cut = await parsePdfIsolated(pdf, { maxPages: 20, maxChars: 500, ...PRODUCTION_LIMITS });

    expect(whole.textLength).toBeGreaterThan(20000);
    expect(cut.text).toHaveLength(500);
    expect(cut.text).toBe(whole.text.slice(0, 500));
    expect(cut.textLength).toBe(whole.textLength);
    expect(cut.numpages).toBe(20);
  }, 20000);

  test('the memory safeguards the platform allows: on Linux the child\'s resident memory is read and its OOM score raised; elsewhere neither', async () => {
    const pdf = buildSyntheticPdf({ pages: 2, linesPerPage: 5 });

    const result = await parsePdfIsolated(pdf, { maxPages: 20, ...PRODUCTION_LIMITS });

    if (process.platform === 'linux') {
      expect(readResidentBytes(process.pid)).toBeGreaterThan(0);
      // Sampled once at least: when the child says it is ready.
      expect(result.peakResidentBytes).toBeGreaterThan(0);
      expect(result.oomScoreAdjusted).toBe(true);
    } else {
      expect(readResidentBytes(process.pid)).toBeNull();
      expect(result.peakResidentBytes).toBeNull();
      expect(result.oomScoreAdjusted).toBe(false);
    }
  }, 15000);

  test('maxPages 0 reads every page', async () => {
    const pdf = buildSyntheticPdf({ pages: 25, linesPerPage: 2 });

    const result = await parsePdfIsolated(pdf, { maxPages: 0, ...PRODUCTION_LIMITS });

    expect(result.numpages).toBe(25);
    expect(result.text).toContain('Page 25 line 2');
  }, 15000);

  test('a file pdf-parse cannot read is a plain parse failure, not a limit', async () => {
    const error = await parsePdfIsolated(Buffer.from('this is not a PDF at all'), {
      maxPages: 20,
      ...PRODUCTION_LIMITS,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBeUndefined();
    expect(error.message.length).toBeGreaterThan(0);
  }, 15000);
});

describe('the deadline', () => {
  test('a parse that never answers is killed at the deadline — PDF_PARSE_LIMIT, reason timeout', async () => {
    const { pids, readResident } = pidRecorder();
    const started = Date.now();

    const error = await parsePdfIsolated(Buffer.from('%PDF'), {
      maxPages: 20,
      timeoutMs: 700,
      memoryLimitMb: 64,
      childModule: child('silent'),
      readResident,
    }).catch((e) => e);

    const elapsed = Date.now() - started;
    expect(error).toMatchObject({
      code: PDF_PARSE_LIMIT,
      reason: 'timeout',
      message: 'PDF parse exceeded its time limit (0.7 s)',
    });
    expect(elapsed).toBeGreaterThanOrEqual(690);
    expect(elapsed).toBeLessThan(3000);
    expect(pids.size).toBe(1);
    expect(await waitUntilGone([...pids][0])).toBe(true);
  }, 15000);

  test('while the child burns CPU without yielding, this process keeps its timers on time', async () => {
    const { pids, readResident } = pidRecorder();
    let last = Date.now();
    let worstLag = 0;
    const ticker = setInterval(() => {
      const now = Date.now();
      worstLag = Math.max(worstLag, now - last - 50);
      last = now;
    }, 50);

    const error = await parsePdfIsolated(Buffer.from('%PDF'), {
      maxPages: 20,
      timeoutMs: 1500,
      memoryLimitMb: 64,
      childModule: child('busy'),
      readResident,
    }).catch((e) => e);
    clearInterval(ticker);

    expect(error).toMatchObject({ code: PDF_PARSE_LIMIT, reason: 'timeout' });
    // In-process, the same loop would have held every timer for the whole 1.5 s.
    expect(worstLag).toBeLessThan(500);
    expect(await waitUntilGone([...pids][0])).toBe(true);
  }, 15000);
});

describe('the memory limit', () => {
  test('a child whose heap grows past --max-old-space-size dies alone — PDF_PARSE_LIMIT, reason memory', async () => {
    const error = await parsePdfIsolated(Buffer.from('%PDF'), {
      maxPages: 20,
      timeoutMs: 30000,
      memoryLimitMb: 48,
      childModule: child('heap'),
      readResident: () => null,
    }).catch((e) => e);

    expect(error).toMatchObject({
      code: PDF_PARSE_LIMIT,
      reason: 'memory',
      message: 'PDF parse exceeded its memory limit (48 MB)',
    });
  }, 40000);

  test('resident memory above the limit (read from /proc on Linux) kills the child at the next sample', async () => {
    const pids = new Set();
    const limitMb = 64;
    const started = Date.now();

    const error = await parsePdfIsolated(Buffer.from('%PDF'), {
      maxPages: 20,
      timeoutMs: 10000,
      memoryLimitMb: limitMb,
      childModule: child('silent'),
      readResident: (pid) => {
        pids.add(pid);
        return limitMb * 1024 * 1024 + 1;
      },
    }).catch((e) => e);

    expect(error).toMatchObject({ code: PDF_PARSE_LIMIT, reason: 'memory' });
    expect(Date.now() - started).toBeLessThan(MEMORY_SAMPLE_INTERVAL_MS + 2000);
    expect(await waitUntilGone([...pids][0])).toBe(true);
  }, 15000);

  test('resident memory at the limit is not over it', async () => {
    const limitMb = 64;
    const error = await parsePdfIsolated(Buffer.from('%PDF'), {
      maxPages: 20,
      timeoutMs: 900,
      memoryLimitMb: limitMb,
      childModule: child('silent'),
      readResident: () => limitMb * 1024 * 1024,
    }).catch((e) => e);

    expect(error).toMatchObject({ code: PDF_PARSE_LIMIT, reason: 'timeout' });
  }, 15000);

  test.each([
    ['VmRSS in kB', 'Name:\tnode\nVmPeak:\t  999 kB\nVmRSS:\t  204800 kB\nThreads:\t7\n', 204800 * 1024],
    ['no VmRSS line (a zombie)', 'Name:\tnode\nState:\tZ (zombie)\n', null],
  ])('parseResidentBytes: %s', (_label, text, expected) => {
    expect(parseResidentBytes(text)).toBe(expected);
  });
});

describe('a child that ends without an answer', () => {
  test('before it took the file: not the file\'s doing — a plain error, the read-around and the retry rule apply', async () => {
    const error = await parsePdfIsolated(Buffer.from('%PDF'), {
      maxPages: 20,
      timeoutMs: 10000,
      memoryLimitMb: 64,
      childModule: child('diesEarly'),
      readResident: () => null,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBeUndefined();
    expect(error.message).toBe('PDF parse process ended before it took the file (exit code 5)');
  }, 15000);

  test('a spawn that fails for lack of descriptors (no stdio, error on the next tick) is a plain error — never an unheard error event', async () => {
    const forkChild = () => {
      const fake = new EventEmitter();
      Object.assign(fake, { pid: undefined, stderr: null, exitCode: null, signalCode: null, kill: () => true });
      process.nextTick(() => fake.emit('error', Object.assign(new Error('spawn EMFILE'), { code: 'EMFILE' })));
      return fake;
    };

    const error = await parsePdfIsolated(Buffer.from('%PDF'), {
      maxPages: 20,
      ...PRODUCTION_LIMITS,
      forkChild,
      readResident: () => null,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBeUndefined();
    expect(error.message).toBe('PDF parse process failed: spawn EMFILE');
  });

  test('after it took the file: a limit too — the same file ends it again: PDF_PARSE_LIMIT, reason exit', async () => {
    const error = await parsePdfIsolated(Buffer.from('%PDF'), {
      maxPages: 20,
      timeoutMs: 10000,
      memoryLimitMb: 64,
      childModule: child('exits'),
      readResident: () => null,
    }).catch((e) => e);

    expect(error).toMatchObject({
      code: PDF_PARSE_LIMIT,
      reason: 'exit',
      message: 'PDF parse process ended without a result (exit code 3)',
    });
  }, 15000);
});

describe('classifyChildEnd — how an end the runner did not cause counts', () => {
  const MB = 1024 * 1024;
  const base = { handedOver: true, code: null, exitSignal: null, stderr: '', peakResident: null, memoryLimitMb: 384 };
  const limitAt = 384 * MB * OUTSIDE_KILL_MEMORY_SHARE;

  test.each([
    ['ended before it took the file', { handedOver: false, code: 1 }, null, 'PDF parse process ended before it took the file (exit code 1)'],
    ['the V8 heap limit on stderr', { code: 134, stderr: 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory' }, 'memory', 'PDF parse exceeded its memory limit (384 MB)'],
    ['SIGKILL from outside with the child near its limit', { exitSignal: 'SIGKILL', peakResident: limitAt }, 'memory', 'PDF parse exceeded its memory limit (384 MB): killed at 192 MB resident'],
    ['SIGKILL from outside with the child far below its limit (the container ran short)', { exitSignal: 'SIGKILL', peakResident: limitAt - 1 }, null, 'PDF parse process was killed from outside (SIGKILL, 192 MB resident)'],
    ['SIGKILL from outside, memory never read', { exitSignal: 'SIGKILL' }, null, 'PDF parse process was killed from outside (SIGKILL, resident memory unknown)'],
    ['Ctrl+C reaching the child', { exitSignal: 'SIGINT' }, null, 'PDF parse process ended without a result (signal SIGINT)'],
    ['a platform stop', { exitSignal: 'SIGTERM' }, null, 'PDF parse process ended without a result (signal SIGTERM)'],
    ['exit code 0 with no answer', { code: 0 }, null, 'PDF parse process ended without a result (exit code 0)'],
    ['a crash, exit code 3', { code: 3 }, 'exit', 'PDF parse process ended without a result (exit code 3)'],
    ['a crash, SIGSEGV', { exitSignal: 'SIGSEGV' }, 'exit', 'PDF parse process ended without a result (signal SIGSEGV)'],
  ])('%s', (_label, end, reason, message) => {
    const error = classifyChildEnd({ ...base, ...end });

    expect(error.message).toBe(message);
    if (reason === null) {
      expect(error.code).toBeUndefined();
    } else {
      expect(error).toMatchObject({ code: PDF_PARSE_LIMIT, reason });
    }
  });
});

describe('the shutdown signal', () => {
  test('already aborted: no child is started — PDF_PARSE_ABORTED', async () => {
    const controller = new AbortController();
    controller.abort();
    const { pids, readResident } = pidRecorder();

    const error = await parsePdfIsolated(Buffer.from('%PDF'), {
      maxPages: 20,
      ...PRODUCTION_LIMITS,
      signal: controller.signal,
      childModule: child('silent'),
      readResident,
    }).catch((e) => e);

    expect(error).toMatchObject({ code: PDF_PARSE_ABORTED, reason: 'aborted' });
    await new Promise((resolve) => setTimeout(resolve, MEMORY_SAMPLE_INTERVAL_MS * 2));
    expect(pids.size).toBe(0);
  }, 15000);

  test('aborted mid-parse: the child is killed at once, long before the deadline', async () => {
    const controller = new AbortController();
    const { pids, readResident } = pidRecorder();
    const started = Date.now();
    setTimeout(() => controller.abort(), 600);

    const error = await parsePdfIsolated(Buffer.from('%PDF'), {
      maxPages: 20,
      ...PRODUCTION_LIMITS,
      signal: controller.signal,
      childModule: child('silent'),
      readResident,
    }).catch((e) => e);

    expect(error).toMatchObject({ code: PDF_PARSE_ABORTED });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(pids.size).toBe(1);
    expect(await waitUntilGone([...pids][0])).toBe(true);
  }, 15000);
});

describe('what the child is started with', () => {
  test('a bare environment (none of the parent\'s keys), its own flags, a lower priority, the whole file', async () => {
    const pdf = Buffer.alloc(300000, 7);
    expect(process.env.DB_HOST ?? process.env.DATABASE_URL ?? process.env.JWT_SECRET).toBeDefined();

    const { text } = await parsePdfIsolated(pdf, {
      maxPages: 20,
      ...PRODUCTION_LIMITS,
      childModule: child('report'),
    });
    const seen = JSON.parse(text);

    // The runner's own list, plus what libuv adds on Windows for a process to start there.
    const allowed = [
      'PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR',
      'HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR',
    ];
    expect(seen.envKeys.map((key) => key.toUpperCase()).filter((key) => !allowed.includes(key))).toEqual([]);
    const parentSecrets = Object.keys(process.env)
      .filter((key) => /^(DB_|DATABASE|JWT|REDIS|OPENROUTER|CLOUDINARY|RESEND|FIREBASE|GOOGLE|YANDEX)/i.test(key));
    expect(parentSecrets.length).toBeGreaterThan(0);
    expect(seen.envKeys.filter((key) => parentSecrets.includes(key))).toEqual([]);
    expect(seen.execArgv).toEqual([`--max-old-space-size=${PDF_PARSE_MEMORY_LIMIT_MB}`]);
    expect(seen.priority).toBe(CHILD_PRIORITY);
    expect(seen.bytes).toBe(pdf.length);
    expect(seen.maxPages).toBe(20);
    expect(seen.maxChars).toBe(0);
  }, 15000);
});
