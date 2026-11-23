/* eslint-env jest */
/**
 * A synchronous child call in the server tests without a time limit is red
 * Синхронный вызов дочернего процесса в тестах сервера без предела ожидания — красный
 *
 * spawnSync, execSync and execFileSync stop jest's event loop until the child
 * exits: jest's test timeout cannot fire. A child that never exits holds the
 * whole run until the CI job's limit (30 min) with no line naming the file
 * (23.11.2026, directive B of the thread «Три слоя памяти»). So every such call
 * under src/tests carries `timeout` in a literal options object — or goes
 * through utils/runScript.js, which does (60 s, SIGKILL).
 *
 * The analysis reads the syntax tree, not the text: a mention in a comment or a
 * string is not a call, and a call split over lines is still one. A call whose
 * options are not a literal object (a variable, a spread alone) cannot be read
 * and is red; so is passing the function on instead of calling it. The expected
 * values below are literals, so a blind analysis fails its own anchors first.
 */

import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default;

const HERE = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(HERE, '..');

const SYNC = new Set(['spawnSync', 'execSync', 'execFileSync']);
const MODULES = new Set(['child_process', 'node:child_process']);

const NO_LIMIT = 'нет timeout в литерале параметров';
const PASSED_ON = 'передан дальше, а не вызван — предел не проверить';

// Parsing every test file takes seconds on a slower machine; jest's default is 10.
const PARSE_TIMEOUT_MS = 60000;

const keyName = (key) => {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'StringLiteral') return key.value;
  return null;
};

/** A `timeout` that is there and is not plainly «no limit» (0, negative, undefined, null, Infinity). */
const limits = (value) => {
  if (value.type === 'NumericLiteral') return value.value > 0;
  if (value.type === 'NullLiteral') return false;
  if (value.type === 'Identifier' && (value.name === 'undefined' || value.name === 'Infinity')) return false;
  if (value.type === 'UnaryExpression' && value.operator === '-') return false;
  return true;
};

const hasLimit = (args) => args.slice(1).some((arg) => arg.type === 'ObjectExpression'
  && arg.properties.some((prop) => prop.type === 'ObjectProperty' && !prop.computed
    && keyName(prop.key) === 'timeout' && limits(prop.value)));

/**
 * @param {Map<string, string>} sources  path → source text
 * @returns {{ sites: Array<{file: string, line: number, callee: string, why: string}>,
 *             limited: Map<string, number> }}  red sites; limited calls per file
 */
export function findUnlimitedSyncCalls(sources) {
  const sites = [];
  const limited = new Map();
  for (const [file, source] of sources) {
    let ast;
    try {
      ast = parser.parse(source, {
        sourceType: 'module',
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true,
      });
    } catch (error) {
      throw new Error(`Сторож синхронных вызовов не смог прочитать ${file}: ${error.message}`);
    }

    // Local names of spawnSync / execSync / execFileSync: a renamed import, or a
    // renaming destructure from anything (`const { spawnSync: run } = cp`,
    // `= await import(...)`, `= require(...)`). By name, not by scope: a test file
    // that reuses such a name for something else is red, and renames it.
    const aliases = new Map();
    traverse(ast, {
      ImportSpecifier(path) {
        const imported = keyName(path.node.imported);
        if (MODULES.has(path.parent.source.value) && SYNC.has(imported)) aliases.set(path.node.local.name, imported);
      },
      ObjectPattern(path) {
        for (const prop of path.node.properties) {
          if (prop.type !== 'ObjectProperty' || prop.computed || prop.value.type !== 'Identifier') continue;
          const name = keyName(prop.key);
          if (SYNC.has(name)) aliases.set(prop.value.name, name);
        }
      },
    });
    const syncName = (node) => {
      if (node.type === 'Identifier') return aliases.get(node.name) ?? (SYNC.has(node.name) ? node.name : null);
      if (node.type !== 'MemberExpression') return null;
      const property = node.computed ? keyName(node.property) : node.property.name;
      return SYNC.has(property) ? property : null;
    };
    const add = (node, callee, why) => sites.push({ file, line: node.loc.start.line, callee, why });

    traverse(ast, {
      CallExpression(path) {
        const callee = syncName(path.node.callee);
        if (!callee) return;
        if (hasLimit(path.node.arguments)) limited.set(file, (limited.get(file) ?? 0) + 1);
        else add(path.node, callee, NO_LIMIT);
      },
      'Identifier|MemberExpression'(path) {
        const callee = syncName(path.node);
        if (!callee) return;
        const { parent, key } = path;
        if (parent.type === 'CallExpression' && key === 'callee') return;
        if (parent.type === 'MemberExpression' && key === 'property') return; // seen as the member itself
        if (['ImportSpecifier', 'ObjectProperty', 'ObjectMethod', 'ClassMethod'].includes(parent.type) && key !== 'value') return;
        if (parent.type === 'ObjectProperty' && path.parentPath.parent.type === 'ObjectPattern') return; // a declaration, seen above
        add(path.node, callee, PASSED_ON);
      },
    });
  }
  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { sites, limited };
}

/** Every .js file under src/tests, by path relative to it. */
function readTestSources(dir) {
  const sources = new Map();
  const walk = (relative) => {
    const entries = readdirSync(join(dir, relative), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.js')) sources.set(child, readFileSync(join(dir, child), 'utf8'));
    }
  };
  walk('');
  return sources;
}

const describeSites = (sites) => [
  `Синхронный вызов дочернего процесса без предела ожидания — ${sites.length}:`,
  ...sites.map(({ file, line, callee, why }) => `  src/tests/${file}:${line} ${callee} — ${why}`),
  'Такой вызов держит jest целиком, пока ребёнок не выйдет: зависший скрипт = 30 мин молчания в CI.',
  'Скрипт проекта — через runScript из src/tests/utils/runScript.js; иное — с { timeout: <мс> } в литерале параметров.',
].join('\n');

/** Sites of one file `a.js` with the given source. */
const sitesOf = (source) => findUnlimitedSyncCalls(new Map([['a.js', source]])).sites
  .map(({ line, callee, why }) => ({ line, callee, why }));

const IMPORT = "import { spawnSync, execSync, execFileSync } from 'child_process';";

describe('the server tests', () => {
  let sources;
  let found;
  beforeAll(() => {
    sources = readTestSources(TESTS_DIR);
    found = findUnlimitedSyncCalls(sources);
  }, PARSE_TIMEOUT_MS);

  test('have no synchronous child call without a time limit', () => {
    if (found.sites.length > 0) throw new Error(describeSites(found.sites));
  });

  test('are read, the helper and the limited unit calls included', () => {
    const { limited } = found;

    expect(sources.has('integration/change-account-email-script.test.js')).toBe(true);
    expect(sources.has('unit/sync-child-timeout-guard.test.js')).toBe(true);
    expect(limited.get('utils/runScript.js')).toBe(1);
    expect(limited.get('unit/logger.test.js')).toBe(2);
    expect(limited.get('unit/setupEnvRateLimits.test.js')).toBe(1);
  });
});

describe('the analysis', () => {
  test('a call with no options, or options without timeout, is red', () => {
    expect(sitesOf(`${IMPORT}
spawnSync('node', ['a.js']);
spawnSync('node', ['a.js'], { encoding: 'utf8' });
execSync('ls');
execFileSync('ls', [], { cwd: '/' });
`)).toEqual([
      { line: 2, callee: 'spawnSync', why: NO_LIMIT },
      { line: 3, callee: 'spawnSync', why: NO_LIMIT },
      { line: 4, callee: 'execSync', why: NO_LIMIT },
      { line: 5, callee: 'execFileSync', why: NO_LIMIT },
    ]);
  });

  test('options it cannot read are red, a timeout that is no limit is red', () => {
    expect(sitesOf(`${IMPORT}
const opts = { timeout: 1000 };
spawnSync('node', ['a.js'], opts);
spawnSync('node', ['a.js'], { ...opts });
spawnSync('node', ['a.js'], { timeout: 0 });
spawnSync('node', ['a.js'], { timeout: undefined });
spawnSync('node', ['a.js'], { timeout: null });
spawnSync('node', ['a.js'], { timeout: -1 });
spawnSync('node', ['a.js'], { timeout: Infinity });
spawnSync('node', ['a.js'], { ['timeout']: 1000 });
`)).toEqual([3, 4, 5, 6, 7, 8, 9, 10].map((line) => ({ line, callee: 'spawnSync', why: NO_LIMIT })));
  });

  test('a call with a timeout passes, however the options are written', () => {
    expect(sitesOf(`${IMPORT}
const timeout = 60000;
const rest = {};
spawnSync('node', ['a.js'], { timeout: 1000 });
spawnSync('node', ['a.js'], { ...rest, timeout, killSignal: 'SIGKILL' });
spawnSync('node', ['a.js'], { 'timeout': 30000 });
spawnSync(
  'node',
  ['a.js'],
  { encoding: 'utf8', timeout: rest.limit },
);
execSync('ls', { timeout: 5 });
execFileSync('ls', ['-l'], { timeout: 5 });
`)).toEqual([]);
  });

  test('a renamed import, a namespace and require-style objects are seen', () => {
    expect(sitesOf(`
import { spawnSync as run, execSync as sh } from 'node:child_process';
import * as cp from 'child_process';
import childProcess from 'child_process';
run('node', ['a.js']);
sh('ls');
cp.spawnSync('node', ['a.js']);
childProcess.execFileSync('ls');
cp.spawnSync('node', ['a.js'], { timeout: 5 });
run('node', ['a.js'], { timeout: 5 });
`)).toEqual([
      { line: 5, callee: 'spawnSync', why: NO_LIMIT },
      { line: 6, callee: 'execSync', why: NO_LIMIT },
      { line: 7, callee: 'spawnSync', why: NO_LIMIT },
      { line: 8, callee: 'execFileSync', why: NO_LIMIT },
    ]);
  });

  test('a destructured name and a name in brackets are seen, the destructure itself is not a site', () => {
    expect(sitesOf(`
import * as cp from 'child_process';
const { spawnSync: run } = cp;
const { execSync: sh } = await import('node:child_process');
const { execFileSync } = require('child_process');
run('node', ['a.js']);
sh('ls');
execFileSync('ls');
cp['spawnSync']('node');
run('node', [], { timeout: 5 });
`)).toEqual([
      { line: 6, callee: 'spawnSync', why: NO_LIMIT },
      { line: 7, callee: 'execSync', why: NO_LIMIT },
      { line: 8, callee: 'execFileSync', why: NO_LIMIT },
      { line: 9, callee: 'spawnSync', why: NO_LIMIT },
    ]);
  });

  test('passing the function on is red', () => {
    expect(sitesOf(`${IMPORT}
import * as cp from 'child_process';
const runner = spawnSync;
const other = cp.execSync;
[1].map(execFileSync);
`)).toEqual([
      { line: 3, callee: 'spawnSync', why: PASSED_ON },
      { line: 4, callee: 'execSync', why: PASSED_ON },
      { line: 5, callee: 'execFileSync', why: PASSED_ON },
    ]);
  });

  test('a mention in a comment or a string is not a call, nor is the async spawn', () => {
    expect(sitesOf(`${IMPORT}
import { spawn, execFile } from 'child_process';
// spawnSync('node', ['a.js']) would hold jest
const text = "spawnSync('node')";
const tpl = \`execSync('ls')\`;
spawn('node', ['a.js']);
execFile('ls', () => {});
`)).toEqual([]);
  });

  test('the report names each place and the way out', () => {
    expect(describeSites([{ file: 'integration/x.test.js', line: 7, callee: 'spawnSync', why: NO_LIMIT }])).toBe([
      'Синхронный вызов дочернего процесса без предела ожидания — 1:',
      '  src/tests/integration/x.test.js:7 spawnSync — нет timeout в литерале параметров',
      'Такой вызов держит jest целиком, пока ребёнок не выйдет: зависший скрипт = 30 мин молчания в CI.',
      'Скрипт проекта — через runScript из src/tests/utils/runScript.js; иное — с { timeout: <мс> } в литерале параметров.',
    ].join('\n'));
  });
});
