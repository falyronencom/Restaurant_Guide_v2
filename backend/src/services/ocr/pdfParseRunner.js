/**
 * PDF Parse Runner — pdf-parse in a child process, with a deadline and a
 * memory limit.
 *
 * The API, the site, the partner cabinet, the moderator panel and the OCR
 * poller share one Node process (railpack.json: `exec node src/server.js`).
 * pdf-parse is synchronous-heavy library code whose time and memory on one
 * file are not bounded by anything we pass it — `max` bounds the pages, not
 * the work on a page. Run in that process, the parse of one menu file took
 * the API's event loop and heap with it. Here it runs in a child process of
 * its own (pdfParseChild.js), so the parse costs the child:
 *
 *   - deadline — the child is killed after `timeoutMs` (wall clock);
 *   - memory — the child's V8 heap is capped with --max-old-space-size, and
 *     where the platform exposes it (/proc on Linux — Railway) the child's
 *     resident memory is read when it is ready and every
 *     MEMORY_SAMPLE_INTERVAL_MS, and the child is killed above the limit:
 *     buffers live outside the V8 heap, so the heap cap alone does not bound
 *     them. Between two samples the memory can still overshoot; the child
 *     volunteers itself to the kernel's OOM killer (oom_score_adj), so a
 *     container short of memory loses the parse before the API — where the
 *     kernel kills one process, not the whole container;
 *   - the answer — the child cuts the text to `maxChars` and reports its full
 *     length, so the API process never receives more text than it uses;
 *   - CPU — the child runs at a lower priority (CHILD_PRIORITY) than the API;
 *   - shutdown — an AbortSignal kills the child at once: graceful shutdown
 *     never waits for a parse (ocrJobPoller.stop()).
 *
 * The child starts with a bare environment (no database URL, no keys) and
 * with its own execArgv — it inherits neither the parent's flags nor
 * NODE_OPTIONS. (On Windows libuv adds the variables a process needs to start
 * there — HOMEDRIVE, USERPROFILE, WINDIR and the like; none is ours.)
 *
 * Outcomes (classifyChildEnd decides how a child that ended without an
 * answer counts):
 *   - resolves { text, textLength, numpages, … } — the parse finished;
 *   - rejects with a plain Error — the cause is not the file: pdf-parse threw
 *     (a damaged file, read around as before), the child could not start or
 *     ended before it took the file, was stopped by a signal from outside, or
 *     was killed from outside while far below its memory limit. ocrService
 *     reads the pages as images without the count, as for any parse failure,
 *     and the retry rule applies;
 *   - rejects with code PDF_PARSE_LIMIT — the child, holding the file, broke
 *     the deadline or the memory limit, or crashed (reason: 'timeout' |
 *     'memory' | 'exit'): the same file does it again on every attempt, so
 *     ocrService fails the job for good;
 *   - rejects with code PDF_PARSE_ABORTED — the signal fired (shutdown): the
 *     file is not at fault, ocrService settles the attempt under the usual
 *     retry rule.
 *
 * The limits themselves are passed in by pdfTextExtractor, where they sit
 * next to the download timeout.
 */

import { fork } from 'child_process';
import { readFileSync } from 'fs';
import { setPriority } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/** The child module run by default (tests pass stand-ins). */
export const PDF_PARSE_CHILD_MODULE = join(dirname(fileURLToPath(import.meta.url)), 'pdfParseChild.js');

/** error.code: the child, holding the file, broke a limit or crashed. */
export const PDF_PARSE_LIMIT = 'PDF_PARSE_LIMIT';

/** error.code: the PDF's download or parse was cut by the caller's signal (shutdown). */
export const PDF_PARSE_ABORTED = 'PDF_PARSE_ABORTED';

/** How often the child's resident memory is read, where it can be. */
export const MEMORY_SAMPLE_INTERVAL_MS = 250;

/**
 * The child's scheduling priority (os.setPriority: -20 highest … 19 lowest;
 * on Windows 10 is "below normal"). The API keeps its share of the CPU while
 * a parse runs; the parse itself takes a fraction of a second, its deadline
 * twenty.
 */
export const CHILD_PRIORITY = 10;

/**
 * A SIGKILL we did not send — on Linux, the kernel's OOM killer — counts as
 * the file's memory only when the child's largest resident sample reached
 * this share of its limit. Below it, the container ran short for another
 * reason (the API, another process), and the file is not to blame.
 */
export const OUTSIDE_KILL_MEMORY_SHARE = 0.5;

/**
 * Signals that stop a process from outside for reasons of their own: Ctrl+C
 * in a terminal (the whole process group), a platform stop, a closed
 * session. Never the file's doing.
 */
const STOP_SIGNALS = new Set(['SIGINT', 'SIGTERM', 'SIGHUP']);

/**
 * The child's stderr kept for the log line of a failed parse: its beginning
 * (V8 writes "FATAL ERROR: … heap out of memory" first, then a native stack
 * trace) and its end.
 */
const STDERR_KEEP_CHARS = 1000;

/**
 * Environment variables the child keeps: enough for Node to start on Linux
 * and Windows, nothing the parent's secrets live in.
 */
const CHILD_ENV_KEYS = ['PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR'];

const childEnv = () => {
  const env = {};
  for (const key of CHILD_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
};

/**
 * Resident memory of a process in bytes, from /proc/<pid>/status (VmRSS, in
 * kB). Null where /proc is absent (Windows, macOS) or the process is gone —
 * the deadline and the heap cap still hold there.
 *
 * @param {number} pid
 * @returns {number|null}
 */
export const readResidentBytes = (pid) => {
  try {
    return parseResidentBytes(readFileSync(`/proc/${pid}/status`, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * The VmRSS line of a /proc/<pid>/status text, in bytes; null without one.
 *
 * @param {string} statusText
 * @returns {number|null}
 */
export const parseResidentBytes = (statusText) => {
  const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(statusText);
  return match ? Number(match[1]) * 1024 : null;
};

const limitError = (reason, message) => Object.assign(new Error(message), { code: PDF_PARSE_LIMIT, reason });

/**
 * The error of a PDF read cut short by shutdown — the parse here, the
 * download in pdfTextExtractor.
 *
 * @param {string} [message]
 * @returns {Error} with code PDF_PARSE_ABORTED
 */
export const abortedError = (message = 'PDF parse cut short by shutdown') => Object.assign(
  new Error(message),
  { code: PDF_PARSE_ABORTED, reason: 'aborted' },
);

/** A child that died of a V8 heap limit says so on stderr. */
const HEAP_EXHAUSTED = /heap out of memory|Reached heap limit|Allocation failed/i;

const megabytes = (bytes) => Math.round(bytes / (1024 * 1024));

/**
 * How a child that ended without an answer counts — the file's doing
 * (PDF_PARSE_LIMIT, the job fails for good) or not (a plain Error, the
 * retry rule and the read-around apply). Ends this runner did not cause:
 * every end it causes (deadline, memory sample, abort) settles first.
 *
 * @param {Object} end
 * @param {boolean} end.handedOver - The file was written to the child
 * @param {number|null} end.code - Exit code
 * @param {string|null} end.exitSignal - Signal that ended it
 * @param {string} end.stderr - What the child wrote to stderr (kept part)
 * @param {number|null} end.peakResident - Largest resident sample, bytes; null — none taken
 * @param {number} end.memoryLimitMb
 * @returns {Error}
 */
export const classifyChildEnd = ({ handedOver, code, exitSignal, stderr, peakResident, memoryLimitMb }) => {
  const how = exitSignal ? `signal ${exitSignal}` : `exit code ${code}`;
  if (!handedOver) {
    return new Error(`PDF parse process ended before it took the file (${how})`);
  }
  if (HEAP_EXHAUSTED.test(stderr)) {
    return limitError('memory', `PDF parse exceeded its memory limit (${memoryLimitMb} MB)`);
  }
  if (exitSignal === 'SIGKILL') {
    const limitBytes = memoryLimitMb * 1024 * 1024;
    if (peakResident !== null && peakResident >= limitBytes * OUTSIDE_KILL_MEMORY_SHARE) {
      return limitError(
        'memory',
        `PDF parse exceeded its memory limit (${memoryLimitMb} MB): killed at ${megabytes(peakResident)} MB resident`,
      );
    }
    const seen = peakResident === null ? 'resident memory unknown' : `${megabytes(peakResident)} MB resident`;
    return new Error(`PDF parse process was killed from outside (SIGKILL, ${seen})`);
  }
  if (STOP_SIGNALS.has(exitSignal) || code === 0) {
    return new Error(`PDF parse process ended without a result (${how})`);
  }
  return limitError('exit', `PDF parse process ended without a result (${how})`);
};

/**
 * Parse a PDF in a child process.
 *
 * @param {Buffer} buffer - The PDF
 * @param {Object} options
 * @param {number} options.maxPages - pdf-parse `max`: pages to read the text of; 0 — all
 * @param {number} [options.maxChars=0] - Characters of text the child sends back; 0 — all
 * @param {number} options.timeoutMs - Deadline for the whole parse, from the start of the child
 * @param {number} options.memoryLimitMb - Heap cap and resident-memory limit of the child
 * @param {AbortSignal} [options.signal] - Kills the child when it fires
 * @param {string} [options.childModule] - Child module to run (tests)
 * @param {(pid: number) => number|null} [options.readResident] - Resident-memory reader (tests)
 * @param {Function} [options.forkChild] - child_process.fork (tests)
 * @returns {Promise<{ text: string, textLength: number, numpages: number,
 *   peakResidentBytes: number|null, oomScoreAdjusted: boolean, durationMs: number }>}
 *   text — at most maxChars; textLength — the text's full length;
 *   peakResidentBytes — the largest resident sample, null where none could be read
 */
export const parsePdfIsolated = (buffer, {
  maxPages,
  maxChars = 0,
  timeoutMs,
  memoryLimitMb,
  signal,
  childModule = PDF_PARSE_CHILD_MODULE,
  readResident = readResidentBytes,
  forkChild = fork,
}) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(abortedError());
    return;
  }

  const limitBytes = memoryLimitMb * 1024 * 1024;
  const startedAt = Date.now();
  let settled = false;
  let handedOver = false;
  let oomScoreAdjusted = false;
  let peakResident = null;
  let stderrHead = '';
  let stderrTail = '';
  let deadlineTimer = null;
  let memoryTimer = null;
  let child;

  const finish = (error, result) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadlineTimer);
    clearInterval(memoryTimer);
    signal?.removeEventListener('abort', onAbort);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    if (error) {
      reject(Object.assign(error, { peakResidentBytes: peakResident }));
    } else {
      resolve(result);
    }
  };

  function onAbort() {
    finish(abortedError());
  }

  /** Read the child's resident memory; kill it above the limit. */
  const sampleMemory = () => {
    const resident = readResident(child.pid);
    if (resident === null) return;
    peakResident = Math.max(peakResident ?? 0, resident);
    if (resident > limitBytes) {
      finish(limitError(
        'memory',
        `PDF parse exceeded its memory limit (${memoryLimitMb} MB): ${megabytes(resident)} MB resident`,
      ));
    }
  };

  try {
    child = forkChild(childModule, [], {
      execArgv: [`--max-old-space-size=${memoryLimitMb}`],
      env: childEnv(),
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
  } catch (error) {
    reject(new Error(`PDF parse process could not start: ${error.message}`));
    return;
  }

  // First, before anything else touches the child: a spawn that fails for
  // lack of descriptors (EMFILE) returns a child without stdio and emits
  // 'error' on the next tick — unheard, that event would end the API process.
  child.on('error', (error) => {
    finish(new Error(`PDF parse process failed: ${error.message}`));
  });

  try {
    setPriority(child.pid, CHILD_PRIORITY);
  } catch {
    // the child is already gone, or the platform refuses — the limits still hold
  }

  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => {
    if (stderrHead.length < STDERR_KEEP_CHARS) {
      stderrHead = (stderrHead + chunk).slice(0, STDERR_KEEP_CHARS);
    }
    stderrTail = (stderrTail + chunk).slice(-STDERR_KEEP_CHARS);
  });

  child.on('message', (answer) => {
    if (settled) return;
    if (answer?.ready) {
      oomScoreAdjusted = answer.oomScoreAdjusted === true;
      sampleMemory();
      if (settled) return;
      // The child listens now: an earlier message could have been lost
      // while its modules were still loading.
      child.send({ pdf: buffer, maxPages, maxChars }, (error) => {
        if (!error) {
          handedOver = true;
          return;
        }
        // A child that died meanwhile is reported by 'close', as one that
        // ended before it took the file.
        if (!settled && child.exitCode === null && child.signalCode === null) {
          finish(new Error(`PDF parse process did not take the file: ${error.message}`));
        }
      });
      return;
    }
    if (answer?.ok) {
      finish(null, {
        text: answer.text,
        textLength: answer.textLength ?? answer.text.length,
        numpages: answer.numpages,
        peakResidentBytes: peakResident,
        oomScoreAdjusted,
        durationMs: Date.now() - startedAt,
      });
    } else {
      finish(new Error(answer?.error || 'PDF parse failed'));
    }
  });

  // 'close', not 'exit': it comes once stderr is read to its end, so the
  // heap-limit message is there to be seen.
  child.on('close', (code, exitSignal) => {
    if (settled) return;
    finish(Object.assign(
      classifyChildEnd({
        handedOver,
        code,
        exitSignal,
        stderr: `${stderrHead}\n${stderrTail}`,
        peakResident,
        memoryLimitMb,
      }),
      { stderrHead },
    ));
  });

  deadlineTimer = setTimeout(() => {
    finish(limitError('timeout', `PDF parse exceeded its time limit (${timeoutMs / 1000} s)`));
  }, timeoutMs);

  memoryTimer = setInterval(sampleMemory, MEMORY_SAMPLE_INTERVAL_MS);

  signal?.addEventListener('abort', onAbort, { once: true });
});
