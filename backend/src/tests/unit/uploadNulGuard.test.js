/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: middleware/upload.js createUpload — правило NUL фильтра на входе
 * (middleware/requestGuard.js) для того, что multer разбирает внутри маршрута,
 * и отказ формы, которую busboy не прочёл целиком.
 *
 * Имя файла с U+0000 отвергается ДО записи на диск: путь временного файла
 * строится из расширения имени, а путь с NUL записать нельзя (проба стенда
 * 16.10.2026). NUL в текстовом поле — в
 * значении или в имени — отвергается после разбора, и уже записанный файл
 * убирается. Отказ — тот же, что у NUL в JSON-теле. Здесь — настоящий multer
 * и busboy на маленьком приложении, без базы; по загрузчикам API —
 * integration/multipart-nul.test.js.
 *
 * Форма, которую busboy не прочёл (обрезана, Content-Type без границы или
 * непрочитываемый, не form-data, испорченный заголовок части), до правки
 * уходила в errorHandler без статуса — 500 (проба 16.10.2026); теперь — 400
 * INVALID_FORMAT. Сбой записи на диск остаётся сбоем сервера. Список текстов
 * busboy сверяется с его исходником (страж ниже). По загрузчикам API —
 * integration/multipart-limits.test.js.
 *
 * NUL собирается в рантайме, не escape-ом в исходнике (см. requestGuard.test.js).
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import * as espree from 'espree';
import logger from '../../utils/logger.js';
import { UNREADABLE_FORM_ERRORS, UNSUPPORTED_TYPE_ERROR_PREFIX, createUpload } from '../../middleware/upload.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const NUL = String.fromCharCode(0);
const BODY_NUL = 'В тексте есть невидимый символ, который нельзя отправить. Наберите текст заново и попробуйте ещё раз.';
const UNREADABLE_FORM = 'Не удалось прочитать отправленные данные. Попробуйте ещё раз.';
const BOUNDARY = 'uploadGuardBoundary9d1e';

let dir;
let fileFilter;

/** Приложение с одним маршрутом загрузки, как в routes/v1: createUpload → обработчик → errorHandler. */
function appWith(options) {
  const app = express();
  app.post('/upload', createUpload(options).single('file'), (req, res) => {
    res.json({ file: req.file ? path.basename(req.file.path) : null, body: { ...req.body } });
  });
  app.use(errorHandler);
  return app;
}

const diskStorage = () => multer.diskStorage({
  destination: dir,
  // Как в маршрутах: расширение — из имени файла клиента.
  filename: (req, file, cb) => cb(null, `f${Date.now()}${path.extname(file.originalname)}`),
});

function rawForm(parts) {
  const chunks = [];
  for (const { disposition, contentType, content } of parts) {
    let head = `--${BOUNDARY}\r\nContent-Disposition: form-data; ${disposition}\r\n`;
    if (contentType) head += `Content-Type: ${contentType}\r\n`;
    chunks.push(Buffer.from(`${head}\r\n`, 'latin1'), Buffer.from(content, 'utf8'), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

const postRaw = (app, parts) => request(app)
  .post('/upload')
  .set('Content-Type', `multipart/form-data; boundary=${BOUNDARY}`)
  .send(rawForm(parts));

const filePart = (filenameParam) => ({
  disposition: `name="file"; ${filenameParam}`, contentType: 'image/png', content: 'not-really-a-png',
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-upload-guard-'));
  fileFilter = jest.fn((req, file, cb) => cb(null, true));
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

function expectRefused(res) {
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('INVALID_FORMAT');
  expect(res.body.message).toBe(BODY_NUL);
  expect(fs.readdirSync(dir)).toEqual([]);
}

describe('имя файла с NUL — отказ до записи на диск', () => {
  test.each([
    ['в расширении', "filename*=utf-8''photo.pn%00g"],
    ['до точки', "filename*=utf-8''pho%00to.png"],
  ])('%s → 400, фильтр маршрута не позван', async (_label, filenameParam) => {
    const res = await postRaw(appWith({ storage: diskStorage(), fileFilter }), [filePart(filenameParam)]);
    expectRefused(res);
    expect(fileFilter).not.toHaveBeenCalled();
  });

  test('без своего фильтра у маршрута — тоже отказ', async () => {
    const res = await postRaw(appWith({ storage: diskStorage() }), [filePart("filename*=utf-8''a.pn%00g")]);
    expectRefused(res);
  });
});

describe('NUL в текстовом поле — отказ после разбора, файл убран', () => {
  test('в значении: файл уже на диске — убирается', async () => {
    const res = await postRaw(appWith({ storage: diskStorage(), fileFilter }), [
      { disposition: 'name="title"', content: `Скидка${NUL}` },
      filePart('filename="photo.png"'),
    ]);
    expectRefused(res);
    expect(fileFilter).toHaveBeenCalledTimes(1);
  });

  test('в значении, поле после файла', async () => {
    const res = await postRaw(appWith({ storage: diskStorage(), fileFilter }), [
      filePart('filename="photo.png"'),
      { disposition: 'name="caption"', content: `a${NUL}` },
    ]);
    expectRefused(res);
  });

  test('форма без файла', async () => {
    const res = await postRaw(appWith({ storage: diskStorage(), fileFilter }), [
      { disposition: 'name="title"', content: `${NUL}` },
    ]);
    expectRefused(res);
  });
});

describe('форма без NUL — как без обёртки', () => {
  test('файл и поля доходят до обработчика, фильтр маршрута позван', async () => {
    const res = await postRaw(appWith({ storage: diskStorage(), fileFilter }), [
      { disposition: 'name="title"', content: `Скидка ${String.fromCharCode(1)} 20%` },
      filePart("filename*=utf-8''%D1%84%D0%BE%D1%82%D0%BE.png"),
    ]);
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ title: `Скидка ${String.fromCharCode(1)} 20%` });
    expect(fs.readdirSync(dir)).toEqual([res.body.file]);
    expect(fileFilter).toHaveBeenCalledTimes(1);
    expect(fileFilter.mock.calls[0][1].originalname).toBe('фото.png');
  });

  test('имя файла с U+0001 — принимается: правило берёт только NUL', async () => {
    // До точки: расширение, из которого строится путь, остаётся «.png» — на
    // Windows U+0001 в пути и сам по себе не записать.
    const res = await postRaw(appWith({ storage: diskStorage(), fileFilter }), [filePart("filename*=utf-8''a%01b.png")]);
    expect(res.status).toBe(200);
    expect(fileFilter.mock.calls[0][1].originalname).toBe(`a${String.fromCharCode(1)}b.png`);
  });

  test('без своего фильтра у маршрута — файл принимается', async () => {
    const res = await postRaw(appWith({ storage: diskStorage() }), [filePart('filename="photo.png"')]);
    expect(res.status).toBe(200);
    expect(fs.readdirSync(dir)).toEqual([res.body.file]);
  });

  test('отказ фильтра маршрута доходит нетронутым', async () => {
    const refusal = new Error('Invalid file type. Only images are allowed.');
    let seen;
    const app = express();
    app.post('/upload', createUpload({ storage: diskStorage(), fileFilter: (req, file, cb) => cb(refusal) }).single('file'), (req, res) => res.json({}));
    app.use((err, req, res, _next) => {
      seen = err;
      res.status(422).json({});
    });

    const res = await postRaw(app, [filePart('filename="doc.txt"')]);
    expect(res.status).toBe(422);
    expect(seen).toBe(refusal);
  });
});

describe('форма, которую busboy не прочёл целиком — 400 через errorHandler', () => {
  const head = (disposition, contentType) => `--${BOUNDARY}\r\nContent-Disposition: form-data; ${disposition}\r\n`
    + `${contentType ? `Content-Type: ${contentType}\r\n` : ''}\r\n`;
  const formType = `multipart/form-data; boundary=${BOUNDARY}`;
  const whole = `${head('name="title"')}Скидка\r\n${head('name="file"; filename="photo.png"', 'image/png')}not-really-a-png\r\n--${BOUNDARY}--\r\n`;

  // Каждая строка — свой текст отказа busboy (последний столбец): список в
  // createUpload держится этими формами, а текст busboy остаётся в журнале.
  test.each([
    ['оборвана на файле, до записи до конца', formType,
      `${head('name="file"; filename="photo.png"', 'image/png')}${'A'.repeat(4096)}`, 'Unexpected end of form'],
    ['нет закрывающей границы после поля', formType, `${head('name="title"')}Скидка\r\n`, 'Unexpected end of form'],
    ['пустое тело', formType, '', 'Unexpected end of form'],
    ['заголовок части без двоеточия', formType,
      `--${BOUNDARY}\r\nContent-Disposition form-data; name="title"\r\n\r\nСкидка\r\n--${BOUNDARY}--\r\n`, 'Malformed part header'],
    ['в Content-Type нет границы', 'multipart/form-data', whole, 'Multipart: Boundary not found'],
    // type-is (и потому multer) пробелы у «=» пропускает, busboy — нет.
    ['в Content-Type пробелы вокруг «=»', `multipart/form-data; boundary = ${BOUNDARY}`, whole, 'Malformed content type'],
    ['не form-data', `multipart/mixed; boundary=${BOUNDARY}`, whole, `Unsupported content type: multipart/mixed; boundary=${BOUNDARY}`],
  ])('%s', async (_label, contentType, body, reason) => {
    const res = await request(appWith({ storage: diskStorage(), fileFilter }))
      .post('/upload')
      .set('Content-Type', contentType)
      .send(Buffer.from(body, 'utf8'));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FORMAT');
    expect(res.body.message).toBe(UNREADABLE_FORM);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Multipart form not readable', expect.objectContaining({ reason }));
  });

  // Обратная сторона: не каждая ошибка разбора — отказ формы. Сбой записи на
  // диск — сбой сервера, он идёт дальше нетронутым (и errorHandler отвечает 500).
  test.each([
    ['ошибка диска', Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC', syscall: 'write' })],
    ['ошибка хранилища без кода', new Error('storage failed')],
  ])('%s при записи файла — доходит нетронутой', async (_label, failure) => {
    const failingStorage = {
      _handleFile: (req, file, cb) => {
        file.stream.on('end', () => cb(failure));
        file.stream.resume();
      },
      _removeFile: (req, file, cb) => cb(null),
    };
    let seen;
    const app = express();
    app.post('/upload', createUpload({ storage: failingStorage }).single('file'), (req, res) => res.json({}));
    app.use((err, req, res, next) => {
      seen = err;
      next(err);
    });
    app.use(errorHandler);

    const res = await request(app).post('/upload').set('Content-Type', formType).send(Buffer.from(whole, 'utf8'));
    expect(seen).toBe(failure);
    expect(res.status).toBe(500);
  });
});

describe('страж: каждый отказ busboy — в списке createUpload или назван недостижимым', () => {
  // busboy отличает отказы формы только текстом, поэтому список в createUpload —
  // это его словарь. Скан исходника busboy, установленного в проект: новый или
  // переименованный текст после обновления пакета — красный тест здесь, а не
  // форма партнёра снова в 500. Пропущенный «Malformed content type» этот скан
  // поймал бы (ревью 16.10.2026).
  const busboyLib = fileURLToPath(new URL('../../../node_modules/busboy/lib/', import.meta.url));

  /** Причина, по которой текст до колбэка createUpload первым не доходит. */
  const UNREACHABLE = {
    'Missing Content-Type': 'без заголовка type-is не признаёт multipart — multer форму не разбирает',
    'Unexpected end of file': 'первой не бывает: при обрыве формы поток файла гибнет той же «Unexpected end of form»',
    'Malformed urlencoded form': 'multer передаёт busboy только multipart',
  };

  /** Текст каждого `new Error(…)` busboy; у шаблона — часть до первой подстановки. */
  const busboyErrorTexts = () => {
    const texts = new Set();
    const walk = (folder) => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) {
          const code = fs.readFileSync(full, 'utf8');
          for (const [, quote, text] of code.matchAll(/new Error\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
            texts.add(quote === '`' ? text.split('${')[0] : text);
          }
        }
      }
    };
    walk(busboyLib);
    return texts;
  };

  test('скан видит отказы busboy', () => {
    expect(busboyErrorTexts().size).toBeGreaterThanOrEqual(8);
  });

  test('список createUpload и недостижимые вместе — ровно тексты busboy', () => {
    const covered = [...UNREADABLE_FORM_ERRORS, UNSUPPORTED_TYPE_ERROR_PREFIX, ...Object.keys(UNREACHABLE)];
    expect([...busboyErrorTexts()].sort()).toEqual([...new Set(covered)].sort());
  });
});

describe('страж: multer строится только через createUpload', () => {
  // Новый загрузчик на голом multer обошёл бы правило NUL. Исходники
  // backend/src (без тестов) разбираются парсером ESLint (espree приходит с
  // eslint из devDependencies; не станет eslint — тест упадёт на импорте, а не
  // позеленеет), и считаются вызовы того имени, под которым файл импортирует
  // 'multer', — прозу в комментариях и строках скан не видит, переименованный
  // импорт видит; присваивание пакета другой переменной и динамический import
  // — нет. Якоря — что скан видит файлы и находит сам createUpload в
  // маршрутах: пустой скан прошёл бы молча.
  const srcRoot = fileURLToPath(new URL('../../', import.meta.url));
  const nodesOf = (ast) => {
    const found = [];
    const pending = [ast];
    while (pending.length > 0) {
      const node = pending.pop();
      found.push(node);
      for (const value of Object.values(node)) {
        for (const child of Array.isArray(value) ? value : [value]) {
          if (child && typeof child.type === 'string') pending.push(child);
        }
      }
    }
    return found;
  };

  /** Сколько раз файл зовёт функцию (и через new): имя — или имена, под которыми импортирован пакет. */
  const callsIn = (nodes, names) => nodes.filter((node) => (node.type === 'CallExpression' || node.type === 'NewExpression')
    && node.callee.type === 'Identifier' && names.includes(node.callee.name)).length;

  const multerNames = (ast) => ast.body
    .filter((node) => node.type === 'ImportDeclaration' && node.source.value === 'multer')
    .flatMap((node) => node.specifiers
      .filter((spec) => spec.type !== 'ImportSpecifier')
      .map((spec) => spec.local.name));

  // Из каждого файла — только счётчики: дерево разбора ~150 файлов, удержанное
  // до конца полного прогона, стоило ему памяти.
  const sources = [];
  const walkFolder = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'tests') walkFolder(full);
      } else if (entry.name.endsWith('.js')) {
        const ast = espree.parse(fs.readFileSync(full, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
        const nodes = nodesOf(ast);
        sources.push({
          file: path.relative(srcRoot, full).split(path.sep).join('/'),
          multerCalls: callsIn(nodes, multerNames(ast)),
          createUploadCalls: callsIn(nodes, ['createUpload']),
        });
      }
    }
  };
  walkFolder(srcRoot);

  test('скан видит исходники', () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.map(({ file }) => file)).toContain('middleware/upload.js');
  });

  test('вызов multer — один, внутри createUpload', () => {
    const calls = sources
      .filter(({ multerCalls }) => multerCalls > 0)
      .map(({ file, multerCalls }) => ({ file, count: multerCalls }));
    expect(calls).toEqual([{ file: 'middleware/upload.js', count: 1 }]);
  });

  test('загрузчики маршрутов строятся через createUpload', () => {
    const builders = sources.filter(({ createUploadCalls }) => createUploadCalls > 0).map(({ file }) => file);
    expect(builders).toEqual(expect.arrayContaining([
      'middleware/upload.js',
      'routes/v1/mediaRoutes.js',
      'routes/v1/promotionRoutes.js',
      'routes/v1/tempMediaRoutes.js',
    ]));
  });
});
