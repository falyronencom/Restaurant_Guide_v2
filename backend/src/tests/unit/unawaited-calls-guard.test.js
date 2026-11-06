/* eslint-env jest */
/**
 * New calls in server code that nobody waits for red the pull request adding them
 * Новый вызов без ожидания в коде сервера красит тот PR, который его добавил
 *
 * Why it matters and what the analysis sees: utils/unawaitedCalls.js. The list of
 * places known today, each with its reason: unawaitedCallsInventory.json. A place
 * outside the list is red, a row with no place is red, and a second such call in
 * one function is red, so the list cannot rot and cannot hide a new call behind an
 * old row. The expected values below are literals, written from the shape each
 * case shows, so that a blind analysis fails its own anchors first.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  REASON_PLACEHOLDER,
  compareWithInventory,
  describeDifference,
  findUnawaitedCalls,
  readServerSources,
} from '../utils/unawaitedCalls.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..', '..');
const INVENTORY_NAME = 'src/tests/unawaitedCallsInventory.json';
const INVENTORY = JSON.parse(readFileSync(join(HERE, '..', 'unawaitedCallsInventory.json'), 'utf8'));
const CLASSES = ['намеренно фоновая', 'будет закрыта'];

// Parsing every server file takes seconds on a slower machine; jest's default is 10.
const PARSE_TIMEOUT_MS = 60000;

const HELPERS = `
  async function save() {}
  async function getClient() {}
  function plain() {}
  const later = () => save().finally(plain);
  const items = [];
`;

/** Sites in one function `run` with the given body. */
const sitesOf = (body) => findUnawaitedCalls({ 'a.js': `${HELPERS}\nasync function run() {\n${body}\n}` });

const row = (file, fn, callee, count, cls = 'будет закрыта') => ({
  file,
  function: fn,
  callee,
  count,
  class: cls,
  reason: 'причина',
});

describe('server code and the inventory', () => {
  test('agree', () => {
    const difference = compareWithInventory(findUnawaitedCalls(readServerSources(SRC_DIR)), INVENTORY.sites);
    const problems = difference.added.length + difference.changed.length + difference.gone.length;
    if (problems > 0) throw new Error(describeDifference(difference, INVENTORY_NAME));
  }, PARSE_TIMEOUT_MS);

  test('every row names its class and its reason, once', () => {
    const keys = INVENTORY.sites.map((site) => `${site.file} | ${site.function} | ${site.callee}`);

    expect(INVENTORY.sites.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    for (const site of INVENTORY.sites) {
      expect({ key: site.file, class: CLASSES.includes(site.class) }).toEqual({ key: site.file, class: true });
      expect(site.reason.trim()).not.toBe('');
      expect(site.reason).not.toContain(REASON_PLACEHOLDER);
      expect(Number.isInteger(site.count) && site.count > 0).toBe(true);
    }
  });
});

describe('what the analysis reports', () => {
  test.each([
    ['а: bare statement', 'save();', 'а', 'save'],
    ['б: .catch as a statement', 'save().catch(() => {});', 'б', 'save'],
    ['б: .then and .finally as a statement', 'save().then(plain).finally(plain);', 'б', 'save'],
    ['в: async IIFE', '(async () => { await save(); })();', 'в', 'async IIFE'],
    ['г: combinator nobody awaits', 'Promise.allSettled([save()]);', 'г', 'Promise.allSettled'],
    ['д: void', 'void save();', 'д', 'save'],
    ['ж: variable never read', 'const pending = save();', 'ж', 'save'],
    ['ж: only a registry remembers it', 'const s = new Set(); const p = save(); s.add(p);', 'ж', 'save'],
    ['з: inside catch', 'try { plain(); } catch { save().catch(plain); }', 'б', 'save'],
    ['з: inside finally', 'try { plain(); } finally { save(); }', 'а', 'save'],
    ['catch chain on an unknown object', 'someObject.write().catch(plain);', 'б', 'someObject.write'],
    ['а: query on a client from getClient', 'const client = await getClient(); client.query("x");', 'а', 'client.query'],
    ['б: chain on an optional call', 'someObject?.write().catch(plain);', 'б', 'someObject.write'],
    ['е: non-async promise function to a timer', 'setInterval(later, 1);', 'е', 'setInterval'],
    ['е: async callback to forEach', 'items.forEach(async () => { await save(); });', 'е', 'items.forEach'],
    ['е: async callback to a timer', 'setTimeout(async () => { await save(); }, 1);', 'е', 'setTimeout'],
  ])('reports %s', (_name, body, pattern, callee) => {
    expect(sitesOf(body).map((site) => [site.pattern, site.function, site.callee]))
      .toEqual([[pattern, 'run', callee]]);
  });

  test('reports a promise returned into a callback nobody waits on, in the callback', () => {
    expect(sitesOf('items.forEach(() => save());').map((site) => [site.pattern, site.function, site.callee]))
      .toEqual([['е', 'run>cb(items.forEach)', 'save']]);
  });

  test.each([
    ['a map nobody takes', 'items.map(() => save());', 'run>cb(items.map)'],
    ['a map kept and never awaited', 'const pending = items.map(() => save());', 'run>cb(items.map)'],
    ['a library that drops it, though returned', 'return library(() => save());', 'run>cb(library)'],
  ])('reports %s', (_name, body, fn) => {
    expect(sitesOf(body).map((site) => [site.pattern, site.function, site.callee])).toEqual([['е', fn, 'save']]);
  });

  test('reports a query on a client received as a parameter', () => {
    expect(findUnawaitedCalls({ 'a.js': 'async function run(client) { client.query("x"); }' })
      .map((site) => site.callee)).toEqual(['client.query']);
  });

  test.each([
    ['awaited', 'await save();'],
    ['returned', 'return save();'],
    ['awaited through a chain', 'await save().catch(plain);'],
    ['awaited through a combinator', 'await Promise.all([save(), save()]);'],
    ['a map the caller awaits', 'await Promise.all(items.map(async () => { await save(); }));'],
    ['variable awaited later', 'const pending = save(); plain(); await pending;'],
    ['variable returned later', 'const pending = save(); return pending;'],
    ['registry and an await', 'const s = new Set(); const p = save(); s.add(p); await p;'],
    ['promise handed to a helper', 'plain(save());'],
    ['synchronous call', 'plain();'],
    ['an async route handler', 'router.post("/x", async () => { await save(); });'],
    ['a handler in asyncHandler', 'asyncHandler(async () => { await save(); });'],
    ['an awaited limiter', 'await library(() => save());'],
    ['a promise array the caller awaits', 'await Promise.all(Array.from(items, () => save()));'],
    ['a map the caller returns', 'return Promise.all(items.map(() => save()));'],
    ['a wrapped function called later', 'const cached = wrap(async () => {}); await cached(1);'],
    ['a chain on another promise', 'await save().then(() => save());'],
  ])('stays silent on %s', (_name, body) => {
    expect(sitesOf(`const router = {}; ${body}`)).toEqual([]);
  });

  test('follows a call into another module, through an object and a default export', () => {
    const sites = findUnawaitedCalls({
      'models/thing.js': 'export const write = async () => {}; export const read = () => 1;\nexport default { write, read };',
      'services/one.js': "import Thing from '../models/thing.js';\nexport function a() { Thing.write(); Thing.read(); }",
      'services/two.js': "import * as Thing from '../models/thing.js';\nexport function b() { Thing.write(); Thing.read(); }",
      'services/three.js': "export async function c() { const { write } = await import('../models/thing.js'); write(); }",
    });

    expect(sites.map((site) => `${site.file} ${site.function} ${site.callee}`)).toEqual([
      'services/one.js a Thing.write',
      'services/two.js b Thing.write',
      'services/three.js c write',
    ]);
  });

  test('follows a class, its instance and this', () => {
    const sites = findUnawaitedCalls({
      'a.js': `class Repo {
        async write() {}
        run() { this.write(); }
      }
      const repo = new Repo();
      function outside() { repo.write(); }`,
    });

    expect(sites.map((site) => `${site.function} ${site.callee}`)).toEqual([
      'Repo.run this.write',
      'outside repo.write',
    ]);
  });

  test('follows a destructured object and a node: import', () => {
    const sites = findUnawaitedCalls({
      'thing.js': 'const write = async () => {}; export default { write };',
      'a.js': "import Thing from './thing.js';\nconst { write } = Thing;\nfunction one() { write(); }",
      'b.js': "import { unlink } from 'node:fs/promises';\nfunction two() { unlink('x'); }",
      'c.js': "import { promises as fs } from 'fs';\nfunction three() { fs.unlink('x'); }",
    });

    expect(sites.map((site) => `${site.function} ${site.callee}`)).toEqual([
      'one write',
      'two unlink',
      'three fs.unlink',
    ]);
  });

  test('an exported wrapped function is not dropped, export * as does not break the reading', () => {
    expect(findUnawaitedCalls({
      'a.js': "export const handler = wrap(async () => {});\nexport * as all from './b.js';",
      'b.js': 'const later = wrap(async () => {});\nexport default later;',
    })).toEqual([]);
  });

  test('a file that cannot be read is named', () => {
    expect(() => findUnawaitedCalls({ 'broken.js': "const a = 'x" })).toThrow('broken.js');
  });

  test('a new route or a default parameter above a place changes no function name', () => {
    const names = (source) => findUnawaitedCalls({ 'a.js': source }).map((site) => site.function);
    const place = "async function save() {}\nrouter.post('/b', async () => { save(); });";

    expect(names(place)).toEqual(["cb(router.post '/b')"]);
    expect(names(`router.post('/a', async () => {});\n${place}`)).toEqual(["cb(router.post '/b')"]);
    expect(names(`async function save() {}
      function make({ now = () => 1 } = {}) { return () => { save(); }; }`)).toEqual(['make>anon']);
  });

  test('counts a function that returns a promise without being async', () => {
    expect(findUnawaitedCalls({
      'a.js': 'const later = () => new Promise(() => {});\nfunction run() { later(); }',
    }).map((site) => site.callee)).toEqual(['later']);
  });

  test('a write through the pool is seen, a nameless callback is named by its parent', () => {
    const sites = findUnawaitedCalls({
      'config/database.js': "import pg from 'pg'; export const pool = new pg.Pool();",
      'routes/x.js': `import { pool } from '../config/database.js';
        export const handler = asyncHandler(async () => { pool.query('INSERT'); });
        router.post('/a', async () => { pool.query('INSERT'); pool.query('INSERT'); });`,
    });

    expect(sites.map((site) => `${site.function} ${site.callee}`)).toEqual([
      'handler pool.query',
      "cb(router.post '/a') pool.query",
      "cb(router.post '/a') pool.query",
    ]);
  });
});

describe('comparing with the inventory', () => {
  const source = 'async function save() {}\nasync function run() { save(); save(); plain(); }\nfunction plain() {}';
  const known = [row('a.js', 'run', 'save', 2)];

  test('a matching inventory is silent', () => {
    expect(compareWithInventory(findUnawaitedCalls({ 'a.js': source }), known))
      .toEqual({ added: [], changed: [], gone: [] });
  });

  test('blank lines above a place change no key', () => {
    const shifted = findUnawaitedCalls({ 'a.js': `\n\n\n\n\n${source}` });

    expect(shifted.map((site) => site.line)).toEqual([7, 7]);
    expect(compareWithInventory(shifted, known)).toEqual({ added: [], changed: [], gone: [] });
  });

  test('editing the arguments changes no key', () => {
    const edited = source.replace('save(); save();', 'save(1, { a: 2 }); save("x");');

    expect(compareWithInventory(findUnawaitedCalls({ 'a.js': edited }), known))
      .toEqual({ added: [], changed: [], gone: [] });
  });

  test('a place outside the inventory is reported, with its line, and tells what to do', () => {
    const difference = compareWithInventory(findUnawaitedCalls({ 'a.js': source }), []);

    expect(difference.added).toEqual([{ file: 'a.js', function: 'run', callee: 'save', pattern: 'а', lines: [2, 2] }]);
    expect(describeDifference(difference, 'опись.json')).toEqual(expect.stringContaining('a.js:2,2'));
    expect(describeDifference(difference, 'опись.json')).toEqual(expect.stringContaining('Дождись записи'));
    expect(describeDifference(difference, 'опись.json')).toEqual(expect.stringContaining('обновись от main'));
  });

  test('a second same call in the function is reported though the row exists', () => {
    const difference = compareWithInventory(
      findUnawaitedCalls({ 'a.js': source }),
      [row('a.js', 'run', 'save', 1)],
    );

    expect(difference.changed).toEqual([
      { file: 'a.js', function: 'run', callee: 'save', pattern: 'а', lines: [2, 2], expected: 1 },
    ]);
  });

  test('a call that went away is reported as a smaller count', () => {
    const fewer = source.replace('save(); save();', 'await save(); save();');

    expect(compareWithInventory(findUnawaitedCalls({ 'a.js': fewer }), known).changed)
      .toEqual([{ file: 'a.js', function: 'run', callee: 'save', pattern: 'а', lines: [2], expected: 2 }]);
  });

  test('a row with no place in the code is reported', () => {
    const difference = compareWithInventory(findUnawaitedCalls({ 'a.js': source }), [...known, row('b.js', 'gone', 'save', 1)]);

    expect(difference.gone).toEqual([row('b.js', 'gone', 'save', 1)]);
    expect(describeDifference(difference, 'опись.json')).toEqual(expect.stringContaining('b.js'));
  });
});
